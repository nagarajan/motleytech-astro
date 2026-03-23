---
title: "Reverse Mouse Scroll Direction"
pubDate: 2016-09-19
category: "Technotes"
tags: ["Mouse", "Scroll", "Direction"]
author: "Nagarajan"
description: "A python 3 based script to reverse the direction of mouse wheel scroll in Windows 10+."
legacySlug: "reverse-mouse-scroll"
disqusIdentifier: "reverse_mouse_scroll"
---
This script edits the Windows registry and turns on the FlipFlopWheel attribute for all USB HID devices. To run this script, save this script as `fixScroll.py` file, and execute it from the windows command prompt running with administrative privileges.

Also, Python 3 should be already pre-installed with Windows 10+, so there will be no need to install Python 3.

```
from winreg import *
import os

def is_admin():
    if os.name == 'nt':
        try:
            # only windows users with admin privileges can read the C:\windows\temp
            temp = os.listdir(os.sep.join([os.environ.get('SystemRoot','C:\\windows'),'temp']))
        except:
            return False
        else:
            return True
    else:
        print('This is a windows script.')
        exit(1)

"""print r"*** Reading from HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Enum\HID ***" """
def main():
    if not is_admin():
        print('Must have admin privileges to run this script.')
        exit(1)
    aReg = ConnectRegistry(None,HKEY_LOCAL_MACHINE)

    FLIP_FLOP_VALUE = 1


    aKey = OpenKey(aReg, r"SYSTEM\CurrentControlSet\Enum\HID")

    for i in range(1024):
        try:
            asubkey_name = EnumKey(aKey, i)
            asubkey = OpenKey(aKey, asubkey_name)
            for j in range(1024):
                try:
                    bsubkey_name = EnumKey(asubkey, j)
                    bsubkey = OpenKey(asubkey, bsubkey_name)
                    for k in range(1024):
                        try:
                            csubkey_name = EnumKey(bsubkey, k)
                            if csubkey_name != 'Device Parameters':
                                continue
                            csubkey = OpenKey(bsubkey, csubkey_name, 0, KEY_ALL_ACCESS)
                            val = QueryValueEx(csubkey, "FlipFlopWheel")

                            print((asubkey_name, bsubkey_name, csubkey_name))
                            SetValueEx(csubkey, 'FlipFlopWheel', 0, REG_DWORD, FLIP_FLOP_VALUE)
                            CloseKey(csubkey)
                            print('Set FFW : %s' % FLIP_FLOP_VALUE)

                        except error as e:
                            if 'No more data' in e.strerror:
                                break
                            continue
                except error as e:
                    if 'No more data' in e.strerror:
                        break
                    continue
        except error as e:
            if 'No more data' in e.strerror:
                break
            continue

if __name__ == "__main__":
    main()
```
