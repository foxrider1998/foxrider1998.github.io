#!/usr/bin/env python3
import urllib.request
import json
import time
import os
import sys

def clear_screen():
    os.system('clear' if os.name == 'posix' else 'cls')

def draw_bar(percentage, length=20):
    filled = int(round(length * percentage / 100))
    bar = "█" * filled + "░" * (length - filled)
    return f"[{bar}] {percentage}%"

def fetch_telemetry(key):
    url = f"https://api.npoint.io/{key}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            return data
    except Exception as e:
        return None

def main():
    if len(sys.argv) > 1:
        key = sys.argv[1]
    else:
        clear_screen()
        print("==================================================")
        print("        JIKONG BMS REMOTE CLI MONITOR             ")
        print("==================================================")
        key = input("Masukkan Remote Access Key Anda: ").strip()
        if not key:
            print("Error: Key tidak boleh kosong.")
            sys.exit(1)

    print(f"\nMenghubungkan ke cloud telemetry bin: {key}...")
    
    # ANSI escape codes for coloring
    GREEN = "\033[92m"
    RED = "\033[91m"
    BLUE = "\033[94m"
    BOLD = "\033[1m"
    RESET = "\033[0m"

    while True:
        data = fetch_telemetry(key)
        
        if not data or 'telemetry' not in data:
            clear_screen()
            print("==================================================")
            print("        JIKONG BMS REMOTE CLI MONITOR             ")
            print("==================================================")
            print(f"Key: {key} | {RED}Status: MENCARI DATA / ERROR{RESET}")
            print("==================================================")
            print("Pastikan HP Anda sudah menyalakan 'Broadcast Cloud' di dashboard.")
            print("Mencoba lagi dalam 3 detik...")
            time.sleep(3)
            continue

        t = data['telemetry']
        s = data.get('settings', {})
        cells = t.get('cells', [])
        
        clear_screen()
        print("==================================================")
        print(f"       {BOLD}JIKONG BMS REMOTE MONITOR (TERMUX){RESET}        ")
        print("==================================================")
        device_name = data.get('connectedDevice', {}).get('name', 'BMS')
        print(f"Key: {key} | Device: {device_name}")
        print(f"Status: {GREEN}CONNECTED (SYNCED){RESET}")
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
        if cells:
            print(f"{BOLD}[Tegangan Sel Individu]{RESET}")
            # Group cells to display 4 cells per row
            row_str = ""
            for i, cell in enumerate(cells):
                idx = cell.get('index', 0)
                volt = cell.get('voltage', 0.0)
                
                # Check for extremes
                cell_label = f"C{idx:02d}: {volt:.3f}V"
                row_str += f"{cell_label:<12} "
                
                if (i + 1) % 4 == 0 or (i + 1) == len(cells):
                    print(row_str)
                    row_str = ""
            
            # Delta calculation
            voltages = [c.get('voltage', 0.0) for c in cells]
            if voltages:
                max_v = max(voltages)
                min_v = min(voltages)
                delta = max_v - min_v
                max_idx = voltages.index(max_v) + 1
                min_idx = voltages.index(min_v) + 1
                print(f"Delta Sel: {delta:.3f} V | Max: C{max_idx:02d} ({max_v:.3f}V) | Min: C{min_idx:02d} ({min_v:.3f}V)")
        else:
            print("Menunggu data tegangan sel...")
            
        print("==================================================")
        print("Tekan Ctrl+C untuk keluar monitor.")
        time.sleep(3)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nKeluar monitor.")
        sys.exit(0)
