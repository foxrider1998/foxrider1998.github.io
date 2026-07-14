#!/usr/bin/env python3
import time
import os
import sys
import subprocess

# ANSI escape codes for coloring
GREEN = "\033[92m"
RED = "\033[91m"
BLUE = "\033[94m"
BOLD = "\033[1m"
RESET = "\033[0m"

def clear_screen():
    os.system('clear' if os.name == 'posix' else 'cls')

def draw_bar(percentage, length=20):
    filled = int(round(length * percentage / 100))
    bar = "█" * filled + "░" * (length - filled)
    return f"[{bar}] {percentage}%"

def read_uint16_be(data, offset):
    return (data[offset] << 8) | data[offset + 1]

def read_int16_be(data, offset):
    val = (data[offset] << 8) | data[offset + 1]
    return val - 65536 if val > 32767 else val

def read_uint32_be(data, offset):
    return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]

def read_int32_be(data, offset):
    val = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
    return val - 4294967296 if val > 2147483647 else val

def parse_warning_flags(flags):
    warnings = []
    if flags & (1 << 0): warnings.append("Low Single Cell Voltage")
    if flags & (1 << 1): warnings.append("Overpack Voltage")
    if flags & (1 << 2): warnings.append("Underpack Voltage")
    if flags & (1 << 3): warnings.append("Overtemp")
    return warnings

def decode_jk_bms_payload(data):
    cmd_type = data[8]
    if cmd_type != 0x06:
        return None

    offset = 11
    length = len(data)
    
    t = {
        "cells": [],
        "temperatures": {},
        "switches": {}
    }
    s = {}

    while offset < length:
        tag = data[offset]
        offset += 1

        if tag == 0x79:
            len_val = data[offset]
            offset += 1
            cell_count = len_val // 3
            for i in range(cell_count):
                idx = data[offset + i*3]
                volt = (data[offset + i*3 + 1] << 8) | data[offset + i*3 + 2]
                t["cells"].append({
                    "index": idx,
                    "voltage": volt / 1000.0,
                    "balancing": False
                })
            offset += len_val
        elif tag == 0x80:
            t["temperatures"]["mosfet"] = read_int16_be(data, offset) * 0.1
            offset += 2
        elif tag == 0x81:
            t["temperatures"]["temp1"] = read_int16_be(data, offset) * 0.1
            offset += 2
        elif tag == 0x82:
            t["temperatures"]["temp2"] = read_int16_be(data, offset) * 0.1
            offset += 2
        elif tag == 0x83:
            t["totalVoltage"] = read_uint16_be(data, offset) * 0.01
            offset += 2
        elif tag == 0x84:
            raw_cur = read_uint16_be(data, offset)
            is_neg = (raw_cur & 0x8000) != 0
            val = raw_cur & 0x7FFF
            t["current"] = -(val * 0.01) if is_neg else (val * 0.01)
            offset += 2
        elif tag == 0x85:
            t["soc"] = data[offset]
            offset += 1
        elif tag == 0x86:
            status_flags = data[offset]
            t["switches"]["charge"] = (status_flags & 0x01) != 0
            t["switches"]["discharge"] = (status_flags & 0x02) != 0
            t["switches"]["balance"] = (status_flags & 0x04) != 0
            offset += 1
        elif tag == 0x8B:
            t["cycleCount"] = read_uint16_be(data, offset)
            offset += 2
        elif tag == 0x87:
            offset += 2
        else:
            # Skip unknown tags
            offset += 2

    # Derived calculations
    if t["cells"]:
        t["cells"].sort(key=lambda x: x["index"])
    t["power"] = t.get("totalVoltage", 0.0) * t.get("current", 0.0)
    
    return t

def render_ui(t):
    clear_screen()
    print("==================================================")
    print(f"     {BOLD}JIKONG BMS ROOT LIVE SNOOP MONITOR{RESET}       ")
    print("==================================================")
    print(f"Status: {GREEN}SNOOPING HCI LOG (/data/log/bt/btsnoop_hci.log){RESET}")
    print("--------------------------------------------------")
    
    # Draw SOC Bar
    soc = t.get('soc', 0)
    soc_color = GREEN if soc > 50 else (RED if soc < 20 else BLUE)
    print(f"SOC: {soc_color}{draw_bar(soc)}{RESET}")
    print("--------------------------------------------------")

    # Pack Info
    vtg = t.get('totalVoltage', 0.0)
    curr = t.get('current', 0.0)
    pwr = t.get('power', 0.0) / 1000  # W to kW
    cycles = t.get('cycleCount', 0)
    
    curr_direction = "Pengisian" if curr > 0.05 else ("Pengosongan" if curr < -0.05 else "Standby")
    curr_color = GREEN if curr > 0.05 else (RED if curr < -0.05 else RESET)
    
    print(f"Tegangan Pack : {vtg:.2f} V")
    print(f"Arus Pack     : {curr_color}{curr:.2f} A ({curr_direction}){RESET}")
    print(f"Daya Listrik  : {pwr:.2f} kW")
    print(f"Jumlah Siklus : {cycles}")
    
    # Temps
    temps = t.get('temperatures', {})
    print(f"Suhu MOSFET   : {temps.get('mosfet', 0.0):.1f}°C")
    print(f"Suhu Sel T1/T2: {temps.get('temp1', 0.0):.1f}°C / {temps.get('temp2', 0.0):.1f}°C")
    print("--------------------------------------------------")
    
    # Switches status
    sw = t.get('switches', {})
    chg_status = f"{GREEN}ON{RESET}" if sw.get('charge') else f"{RED}OFF{RESET}"
    dch_status = f"{GREEN}ON{RESET}" if sw.get('discharge') else f"{RED}OFF{RESET}"
    bal_status = f"{GREEN}ON{RESET}" if sw.get('balance') else f"{RED}OFF{RESET}"
    print(f"Saklar -> CHG: {chg_status} | DCH: {dch_status} | BAL: {bal_status}")
    print("--------------------------------------------------")
    
    # Cell Grid
    cells = t.get('cells', [])
    if cells:
        print(f"{BOLD}[Tegangan Sel Individu]{RESET}")
        row_str = ""
        for i, cell in enumerate(cells):
            idx = cell.get('index', 0)
            volt = cell.get('voltage', 0.0)
            cell_label = f"C{idx:02d}: {volt:.3f}V"
            row_str += f"{cell_label:<12} "
            if (i + 1) % 4 == 0 or (i + 1) == len(cells):
                print(row_str)
                row_str = ""
        
        voltages = [c.get('voltage', 0.0) for c in cells]
        if voltages:
            max_v = max(voltages)
            min_v = min(voltages)
            delta = max_v - min_v
            max_idx = voltages.index(max_v) + 1
            min_idx = voltages.index(min_v) + 1
            print(f"Delta Sel: {delta:.3f} V | Max: C{max_idx:02d} ({max_v:.3f}V) | Min: C{min_idx:02d} ({min_v:.3f}V)")
    else:
        print("Menunggu data telemetry terdeteksi di HCI Log...")
    print("==================================================")

def main():
    print("Memulai sadap bluetooth log...")
    
    # Perintah su untuk membaca file secara live (tail -f)
    cmd = ["su", "-c", "tail -f -c +0 /data/log/bt/btsnoop_hci.log"]
    
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    
    buffer = bytearray()
    
    try:
        while True:
            # Baca byte per byte dari output tail log secara non-blocking
            byte = proc.stdout.read(1)
            if not byte:
                time.sleep(0.01)
                continue
            
            buffer.extend(byte)
            
            # Cari marker awal JKBMS packet (4E 57)
            header_idx = buffer.find(b'\x4e\x57')
            if header_idx == -1:
                # Batasi buffer agar tidak over-memory jika data sampah menumpuk
                if len(buffer) > 2000:
                    del buffer[:-100]
                continue
            
            # Geser kursor ke awal header
            if header_idx > 0:
                del buffer[:header_idx]
                
            if len(buffer) < 4:
                continue
                
            # Baca panjang data packet (byte 2 & 3)
            packet_len = (buffer[2] << 8) | buffer[3]
            
            # Tunggu sampai seluruh chunk terkumpul sesuai panjang packet
            if len(buffer) < packet_len:
                continue
                
            packet = buffer[:packet_len]
            del buffer[:packet_len]
            
            # Parsing data jika checksum valid
            if packet_len > 8:
                data_part = packet[:-4]
                rx_checksum = (packet[-4] << 24) | (packet[-3] << 16) | (packet[-2] << 8) | packet[-1]
                calculated_checksum = sum(data_part)
                
                if calculated_checksum == rx_checksum:
                    telemetry = decode_jk_bms_payload(data_part)
                    if telemetry:
                        render_ui(telemetry)

    except KeyboardInterrupt:
        print("\nMonitoring dihentikan.")
        proc.terminate()
        sys.exit(0)

if __name__ == "__main__":
    main()
