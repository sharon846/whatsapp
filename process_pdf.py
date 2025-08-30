#!/usr/bin/env python3
import sys, os, shutil

def main():
    if len(sys.argv) < 2:
        print("Usage: process_pdf.py <input_path>")
        return 1
    inp = sys.argv[1]
    if not os.path.isfile(inp):
        print(f"Input file not found: {inp}")
        return 1
    base = os.path.basename(inp)
    out_path = os.path.join(os.path.dirname(inp), f"processed_{base}")
    shutil.copyfile(inp, out_path)
    print(out_path)
    return 0

if __name__ == "__main__":
    sys.exit(main())
