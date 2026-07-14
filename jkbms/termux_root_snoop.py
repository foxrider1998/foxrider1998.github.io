#!/usr/bin/env python3
import time
import os
import sys
import subprocess
import urllib.request
import json

# ANSI escape codes for coloring
GREEN = "\033[92m"
RED = "\033[91m"
BLUE = "\033[94m"
YELLOW = "\033[93m"
BOLD = "\033[1m"
RESET = "\033[0m"

def read_uint16_be(data, offset):
    return (data[offset] << 8) | data[offset + 1]

def read_int16_be(data, offset):
    val = (data[offset] << 8) | data[offset + 1]
    return val - 65536 if val > 32767 else val

def read_uint32_be(data, offset):
    return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]

def decode_legacy_55aa_payload(data):
    """
    Parser untuk protokol JK04 Legacy (Header wajib: 55 AA EB 90)
    """
    t = {
        "cells": [],
        "temperatures": {},
        "switches": {"charge": True, "discharge": True, "balance": True}
    }
    
    try:
        # Baca tegangan sel (Maksimal 16 sel, offset mulai dari byte 8)
        for i in range(16):
            off = 8 + (i * 2)
            if off + 1 < len(data):
                mv = read_uint16_be(data, off)
                # Sanity Check: LiFePO4 / Li-Ion sel normal ada di rentang 2.0V - 4.3V (2000 - 4300 mV)
                if 2000 <= mv <= 4300:
                    t["cells"].append({
                        "index": i + 1,
                        "voltage": mv / 1000.0,
                        "balancing": False
                    })
        
        # Suhu MOSFET & Sensor (Offset 76-77)
        if 77 < len(data):
            raw_temp = read_int16_be(data, 76)
            temp_c = raw_temp * 0.1
            # Sanity Check Suhu: Abaikan jika gila (misal -947 C)
            if -40 <= temp_c <= 100:
                t["temperatures"]["mosfet"] = temp_c
                t["temperatures"]["temp1"] = temp_c
                t["temperatures"]["temp2"] = temp_c
            
        # Total Voltage 0.01V (Offset 48-49)
        if 49 < len(data):
            vtg = read_uint16_be(data, 48) * 0.01
            if vtg > 10.0: # Baterai Anda 38.4V, abaikan jika baca 0.00V
                t["totalVoltage"] = vtg
            
        # Current 0.01A Signed (Offset 52-53)
        if 53 < len(data):
            t["current"] = read_int16_be(data, 52) * 0.01
            
        # SOC % (Offset 86)
        if 86 < len(data):
            soc_val = data[86]
            # Sanity Check: SOC wajib 0 - 100% (Mencegah muncul angka 172%)
            if 0 <= soc_val <= 100:
                t["soc"] = soc_val
            else:
                return None # Data rusak, buang!
        else:
            t["soc"] = 0
            
        t["power"] = t.get("totalVoltage", 0.0) * t.get("current", 0.0)
        
        # Jika tegangan total atau sel kosong, anggap frame cacat
        if not t.get("totalVoltage") or len(t["cells"]) == 0:
            return None
            
        return t
    except Exception:
        return None

def decode_jk_bms_payload(data):
    """
    Parser untuk protokol JK02 Modern (Header wajib: 4E 57 00 13)
    Menggunakan arsitektur TLV (Tag-Length-Value)
    """
    offset = 11  # TLV selalu dimulai setelah byte ke-10
    length = len(data) - 5  # Potong 5 byte di akhir (checksum & EOF)
    
    t = {
        "cells": [],
        "temperatures": {},
        "switches": {"charge": True, "discharge": True, "balance": True}
    }
    
    while offset < length:
        tag = data[offset]
        tag_len = data[offset + 1]
        val_offset = offset + 2
        
        if val_offset + tag_len > len(data):
            break
            
        if tag == 0x79:  # Cell Voltages
            cell_count = tag_len // 3
            for i in range(cell_count):
                idx = data[val_offset + (i * 3)]
                mv = (data[val_offset + (i * 3) + 1] << 8) | data[val_offset + (i * 3) + 2]
                if 2000 <= mv <= 4300:
                    t["cells"].append({
                        "index": idx,
                        "voltage": mv / 1000.0,
                        "balancing": False
                    })
        elif tag == 0x80:  # Temp MOSFET
            t["temperatures"]["mosfet"] = read_int16_be(data, val_offset) * 0.1
        elif tag == 0x81:  # Temp 1
            t["temperatures"]["temp1"] = read_int16_be(data, val_offset) * 0.1
        elif tag == 0x82:  # Temp 2
            t["temperatures"]["temp2"] = read_int16_be(data, val_offset) * 0.1
        elif tag == 0x83:  # Total Voltage (0.01V)
            t["totalVoltage"] = read_uint16_be(data, val_offset) * 0.01
        elif tag == 0x84:  # Current (0.01A Signed)
            raw_cur = read_uint16_be(data, val_offset)
            if raw_cur & 0x8000:
                t["current"] = -((raw_cur & 0x7FFF) * 0.01)
            else:
                t["current"] = raw_cur * 0.01
        elif tag == 0x85:  # SOC %
            soc_val = data[val_offset]
            if 0 <= soc_val <= 100:
                t["soc"] = soc_val
        elif tag == 0x86:  # Suhu versi alternatif / Status
            pass
        elif tag == 0x8B:  # Cycle Count
            t["cycleCount"] = read_uint16_be(data, val_offset)

        offset += (2 + tag_len)

    if t["cells"]:
        t["cells"].sort(key=lambda x: x["index"])
    t["power"] = t.get("totalVoltage", 0.0) * t.get("current", 0.0)
    
    # Sanity check akhir: buang jika SOC gila atau tegangan nol
    if t.get("soc", -1) < 0 or not t.get("totalVoltage"):
        return None
        
    return t

def upload_to_cloud(telemetry, key="0d6013fe3fa362ab0388"):
    url = f"https://api.npoint.io/{key}"
    payload = {
        "timestamp": int(time.time()),
        "mode": "remote",
        "connectionStatus": "connected",
        "connectedDevice": {
            "name": "Termux Root Snoop",
            "address": "LocalHCI"
        },
        "telemetry": telemetry
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=3) as res:
            res.read()
    except Exception:
        pass

last_upload_time = 0

def render_ui(t):
    global last_upload_time
    
    vtg = t.get('totalVoltage', 0.0)
    curr = t.get('current', 0.0)
    soc = t.get('soc', 0)
    temp = t.get('temperatures', {}).get('mosfet', 0.0)
    
    cells = t.get('cells', [])
    # Format string untuk 8 sel pertama
    cell_v_str = ", ".join([f"C{c['index']}:{c['voltage']:.3f}V" for c in cells[:8]])
    if len(cells) > 8:
        cell_v_str += f" (+{len(cells)-8} sel)"

    timestamp = time.strftime("%H:%M:%S")
    
    # Warna indikator arus
    curr_color = GREEN if curr >= 0 else YELLOW
    
    print(f"[{timestamp}] {BOLD}V={vtg:.2f}V{RESET} | {curr_color}I={curr:+.2f}A{RESET} | {BLUE}SOC={soc}%{RESET} | Temp={temp:.1f}°C | {cell_v_str}")
    
    now = time.time()
    if now - last_upload_time >= 3.0:
        last_upload_time = now
        upload_to_cloud(t)

def main():
    print(f"{GREEN}{BOLD}=== JKBMS Native PCAP Snoop Parser (Fixed) ==={RESET}")
    print("Membaca stream /data/log/bt/btsnoop_hci.log dari sistem Android...")
    
    cmd = ["su", "-c", "tail -f -c +0 /data/log/bt/btsnoop_hci.log"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    
    # 1. Skip Btsnoop File Header (16 bytes)
    header = proc.stdout.read(16)
    if len(header) < 16 or not header.startswith(b'btsnoop\0'):
        print(f"{RED}[Error] Format file btsnoop tidak valid atau izin Root ditolak.{RESET}")
        proc.terminate()
        sys.exit(1)
        
    print(f"{GREEN}Header btsnoop terverifikasi. Menunggu paket telemetry BMS...{RESET}\n")
    
    try:
        while True:
            rec_hdr = proc.stdout.read(24)
            if len(rec_hdr) < 24:
                time.sleep(0.02)
                continue
                
            incl_len = read_uint32_be(rec_hdr, 4)
            payload = proc.stdout.read(incl_len)
            if len(payload) < incl_len:
                continue
                
            # ==========================================================
            # PERBAIKAN KRUSIAL: Cari Header MUTLAK 4-Byte (Bukan 2-Byte)
            # ==========================================================
            is_legacy = False
            header_idx = -1
            
            # Cari 4E 57 00 13 (JK02 Modern)
            idx_4e57 = payload.find(b'\x4e\x57\x00\x13')
            # Cari 55 AA EB 90 (JK04 Legacy)
            idx_55aa = payload.find(b'\x55\xaa\xeb\x90')
            
            if idx_4e57 != -1:
                header_idx = idx_4e57
            elif idx_55aa != -1:
                header_idx = idx_55aa
                is_legacy = True
                
            # Jika tidak ada header 4-byte yang sah, abaikan paket sampah ini!
            if header_idx == -1:
                continue
                
            clean_packet = payload[header_idx:]
            
            if is_legacy:
                if len(clean_packet) >= 110:
                    telemetry = decode_legacy_55aa_payload(clean_packet)
                    if telemetry:
                        render_ui(telemetry)
            else:
                # PERBAIKAN KRUSIAL: Baca panjang payload dari Bytes [4..5]!
                if len(clean_packet) >= 11:
                    payload_len = (clean_packet[4] << 8) | clean_packet[5]
                    total_expected_len = payload_len + 11
                    
                    # Pastikan paket btsnoop sudah menampung frame secara utuh
                    if len(clean_packet) >= total_expected_len:
                        frame_data = clean_packet[:total_expected_len]
                        
                        # Ekstrak dan parse langsung (tanpa filter checksum yang sering membuang data valid di sadapan PCAP)
                        telemetry = decode_jk_bms_payload(frame_data)
                        if telemetry:
                            render_ui(telemetry)

    except KeyboardInterrupt:
        print(f"\n{YELLOW}Monitoring dihentikan oleh pengguna.{RESET}")
        proc.terminate()
        sys.exit(0)

if __name__ == "__main__":
    main()
