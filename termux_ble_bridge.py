#!/usr/bin/env python3
import asyncio
import sys
import json
import urllib.request
from bleak import BleakClient, BleakScanner

# JKBMS GATT service and characteristic UUIDs
SERVICE_UUIDS = [
    "0000ffe0-0000-1000-8000-00805f9b34fb", # Standard ffe0
    "6e400001-b5a3-f393-e0a9-e50e24dcca9e", # Nordic NUS
    "0000ffe5-0000-1000-8000-00805f9b34fb"  # Alt ffe5
]

CHAR_RX_UUIDS = [
    "0000ffe1-0000-1000-8000-00805f9b34fb", # Standard RX (Notify)
    "6e400003-b5a3-f393-e0a9-e50e24dcca9e", # Nordic NUS RX (Notify)
    "0000ffe9-0000-1000-8000-00805f9b34fb"  # Alt RX (Notify)
]

CHAR_TX_UUIDS = [
    "0000ffe1-0000-1000-8000-00805f9b34fb", # Standard TX (Write)
    "6e400002-b5a3-f393-e0a9-e50e24dcca9e", # Nordic NUS TX (Write)
    "0000ffe9-0000-1000-8000-00805f9b34fb"  # Alt TX (Write)
]

# Global buffer to store incoming BLE chunks
rx_buffer = bytearray()
latest_telemetry = {}
latest_settings = {}
is_data_ready = False

# Helper functions to read big-endian binary values
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
    if flags & (1 << 0): warnings.append("Low Single Cell Voltage Protection")
    if flags & (1 << 1): warnings.append("Overpack Voltage Protection")
    if flags & (1 << 2): warnings.append("Underpack Voltage Protection")
    if flags & (1 << 3): warnings.append("Charge Overtemp Protection")
    if flags & (1 << 4): warnings.append("Charge Low Temp Protection")
    if flags & (1 << 5): warnings.append("Discharge Overtemp Protection")
    if flags & (1 << 6): warnings.append("Discharge Low Temp Protection")
    if flags & (1 << 7): warnings.append("Charge Overcurrent Protection")
    if flags & (1 << 8): warnings.append("Discharge Overcurrent Protection")
    if flags & (1 << 9): warnings.append("Short Circuit Protection")
    if flags & (1 << 10): warnings.append("MOSFET Overtemp Protection")
    if flags & (1 << 11): warnings.append("Cell Voltage Imbalance Protection")
    return warnings

# JKBMS Frame Packet Parser
def decode_jk_bms_packet(data):
    global latest_telemetry, latest_settings, is_data_ready
    cmd_type = data[8]
    if cmd_type != 0x06:
        return

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
            t["temperatures"]["mosfet"] = read_int16_be(data, offset)
            offset += 2
        elif tag == 0x81:
            t["temperatures"]["temp1"] = read_int16_be(data, offset)
            offset += 2
        elif tag == 0x82:
            t["temperatures"]["temp2"] = read_int16_be(data, offset)
            offset += 2
        elif tag == 0x83:
            t["totalVoltage"] = read_uint32_be(data, offset) / 100.0
            offset += 4
        elif tag == 0x84:
            t["current"] = read_int32_be(data, offset) / 100.0
            offset += 4
        elif tag == 0x85:
            val = read_uint32_be(data, offset)
            t["remainingCapacity"] = val / 1000.0 if val > 10000 else val / 100.0
            offset += 4
        elif tag == 0x87:
            t["cycleCount"] = read_uint16_be(data, offset)
            offset += 2
        elif tag == 0x89:
            val = read_uint32_be(data, offset)
            s["nominalCapacity"] = val / 1000.0 if val > 10000 else val / 100.0
            t["totalCapacity"] = s["nominalCapacity"]
            offset += 4
        elif tag == 0x8A:
            s["cellCount"] = read_uint16_be(data, offset)
            offset += 2
        elif tag == 0x8B:
            warning_flags = read_uint16_be(data, offset)
            t["warnings"] = parse_warning_flags(warning_flags)
            offset += 2
        elif tag == 0x8C:
            status_flags = data[offset]
            t["switches"]["charge"] = (status_flags & 0x01) != 0
            t["switches"]["discharge"] = (status_flags & 0x02) != 0
            t["switches"]["balance"] = (status_flags & 0x04) != 0
            offset += 1
        elif tag == 0x90:
            s["cellOvervoltageProtect"] = read_uint16_be(data, offset) / 1000.0
            offset += 2
        elif tag == 0x91:
            s["cellUndervoltageProtect"] = read_uint16_be(data, offset) / 1000.0
            offset += 2
        elif tag == 0x92:
            s["cellOvervoltageRecovery"] = read_uint16_be(data, offset) / 1000.0
            offset += 2
        elif tag == 0x93:
            s["cellUndervoltageRecovery"] = read_uint16_be(data, offset) / 1000.0
            offset += 2
        elif tag == 0x94:
            s["maxChargeCurrent"] = read_uint16_be(data, offset) / 10.0
            offset += 2
        elif tag == 0x95:
            s["maxDischargeCurrent"] = read_uint16_be(data, offset) / 10.0
            offset += 2
        elif tag == 0x96:
            s["balanceStartVoltage"] = read_uint16_be(data, offset) / 1000.0
            offset += 2
        elif tag == 0x97:
            s["balanceTriggerDiff"] = read_uint16_be(data, offset) / 1000.0
            offset += 2
        elif tag == 0x98:
            s["maxBalanceCurrent"] = read_uint16_be(data, offset) / 10.0
            offset += 2
        elif tag == 0x9D:
            t["switches"]["charge"] = data[offset] == 1
            offset += 1
        elif tag == 0x9E:
            t["switches"]["discharge"] = data[offset] == 1
            offset += 1
        elif tag == 0x9F:
            t["switches"]["balance"] = data[offset] == 1
            offset += 1
        else:
            # Skip unknown tags
            if tag >= 0x90 and tag <= 0x9B: offset += 2
            elif tag >= 0x9C and tag <= 0x9F: offset += 1
            elif tag in [0x86, 0x8E, 0x8F]: offset += 1
            elif tag in [0x88, 0x8C]: offset += 1
            elif tag == 0x79: offset += data[offset] + 1
            else: offset += 2

    # Derived calculations
    if t["cells"]:
        t["cells"].sort(key=lambda x: x["index"])
        min_c = min(t["cells"], key=lambda x: x["voltage"])
        max_c = max(t["cells"], key=lambda x: x["voltage"])
        diff = max_c["voltage"] - min_c["voltage"]
        t["balancersActive"] = False
        t["balanceCurrent"] = 0.0
        
        if t["switches"].get("balance") and diff > s.get("balanceTriggerDiff", 0.01) and max_c["voltage"] >= s.get("balanceStartVoltage", 3.2):
            t["balancersActive"] = True
            max_c["balancing"] = "discharge"
            min_c["balancing"] = "charge"

    t["power"] = t.get("totalVoltage", 0.0) * t.get("current", 0.0)
    t["soc"] = round((t.get("remainingCapacity", 0.0) / s.get("nominalCapacity", 1.0)) * 100) if s.get("nominalCapacity") else 0
    if t["soc"] > 100: t["soc"] = 100
    
    latest_telemetry = t
    latest_settings = s
    is_data_ready = True

# Process BLE binary frame streams
def handle_notification(sender, data):
    global rx_buffer
    rx_buffer.extend(data)

    while True:
        header_idx = rx_buffer.find(b'\x4e\x57')
        if header_idx == -1:
            if len(rx_buffer) > 1000:
                rx_buffer.clear()
            break

        if header_idx > 0:
            del rx_buffer[:header_idx]

        if len(rx_buffer) < 4:
            break

        packet_len = (rx_buffer[2] << 8) | rx_buffer[3]
        if len(rx_buffer) < packet_len:
            break

        packet = rx_buffer[:packet_len]
        del rx_buffer[:packet_len]

        if packet_len > 8:
            data_part = packet[:-4]
            rx_checksum = read_uint32_be(packet, packet_len - 4)
            calculated_checksum = sum(data_part)

            if calculated_checksum == rx_checksum:
                decode_jk_bms_packet(data_part)
            else:
                print(f"[Warn] Checksum mismatch. Calc: {calculated_checksum}, Rx: {rx_checksum}")

# Post parsed JKBMS JSON payload to npoint.io cloud bin
def upload_to_cloud(bin_id, device_name, address):
    global latest_telemetry, latest_settings, is_data_ready
    if not is_data_ready:
        return

    url = f"https://api.npoint.io/{bin_id}"
    payload = {
        "timestamp": 2025,
        "mode": "remote",
        "connectionStatus": "connected",
        "connectedDevice": {
            "name": device_name,
            "address": address
        },
        "telemetry": latest_telemetry,
        "settings": latest_settings
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=5) as res:
            res.read()
            print(f"[Cloud] Telemetry uploaded successfully! (SOC: {latest_telemetry['soc']}%)")
    except Exception as e:
        print(f"[Error] Cloud upload failed: {e}")

async def main():
    if len(sys.argv) < 2:
        print("==========================================================")
        print("     JIKONG BMS TERMUX BLUETOOTH TO CLOUD BRIDGE          ")
        print("==========================================================")
        print("Penggunaan:")
        print("  python termux_ble_bridge.py [MAC_BMS] [BIN_ID_NPOINT]")
        print("\nContoh:")
        print("  python termux_ble_bridge.py AA:BB:CC:DD:EE:FF")
        print("  (Otomatis menggunakan Key default: 0d6013fe3fa362ab0388)")
        print("==========================================================")
        
        print("\nMencari perangkat Jikong BMS di sekitar Anda...")
        devices = await BleakScanner.discover()
        jk_devices = [d for d in devices if d.name and ("JK-" in d.name or "BMS" in d.name)]
        if jk_devices:
            print("\nDitemukan perangkat Jikong BMS:")
            for d in jk_devices:
                print(f"  - MAC Address: {d.address} | Name: {d.name}")
        else:
            print("\nTidak ditemukan perangkat Jikong. Pastikan Bluetooth aktif dan BMS dalam jangkauan.")
        sys.exit(1)

    mac_address = sys.argv[1]
    bin_id = sys.argv[2] if len(sys.argv) >= 3 else '0d6013fe3fa362ab0388'

    print(f"Menghubungkan ke JKBMS [{mac_address}]...")
    client = BleakClient(mac_address)

    try:
        await client.connect()
        print(f"Bluetooth Terhubung ke {mac_address}!")

        # Resolve Rx/Tx Characteristics
        rx_char = None
        tx_char = None

        for service in client.services:
            if service.uuid in SERVICE_UUIDS:
                for char in service.characteristics:
                    if char.uuid in CHAR_RX_UUIDS:
                        rx_char = char
                    if char.uuid in CHAR_TX_UUIDS:
                        tx_char = char

        if not rx_char or not tx_char:
            print("[Error] Karakteristik JKBMS tidak ditemukan.")
            await client.disconnect()
            sys.exit(1)

        print("Berhasil menemukan karakteristik JKBMS.")
        
        # Subscribe to notify characteristic
        await client.start_notify(rx_char, handle_notification)
        print("Subskripsi notifikasi data aktif.")

        # JKBMS status query frame packet
        query_packet = bytearray([
            0x4E, 0x57, 0x00, 0x16, 0x00, 0x00, 0x00, 0x00, 
            0x06, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 
            0x00, 0x00, 0x00, 0x00, 0x00, 0xC4
        ])

        # Main Loop: Send query packet every 5 seconds, upload telemetry on reply
        while True:
            try:
                # Write status query command
                await client.write_gatt_char(tx_char, query_packet, response=False)
                await asyncio.sleep(1) # wait for reply & decode
                
                # Upload decoded data to cloud
                upload_to_cloud(bin_id, client.address, "Termux BLE Bridge")
                
                await asyncio.sleep(9) # Wait remaining 9s for a 10s cycle
            except Exception as e:
                print(f"[Loop Error] {e}")
                await asyncio.sleep(5)

    except Exception as e:
        print(f"Gagal menghubungkan: {e}")
    finally:
        if client.is_connected:
            await client.disconnect()
            print("Koneksi Bluetooth terputus.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nBridge dihentikan.")
        sys.exit(0)
