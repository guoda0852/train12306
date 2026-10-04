#!/usr/bin/env python3
"""由 worker.template.js + stations.compact.json 生成可部署的 worker.js"""
import os

BASE = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(BASE, 'worker.template.js'), encoding='utf-8') as f:
    tpl = f.read()
with open(os.path.join(BASE, 'stations.compact.json'), encoding='utf-8') as f:
    stations = f.read()

out = tpl.replace('//__STATIONS_INJECT__', 'const STATIONS = ' + stations + ';')
with open(os.path.join(BASE, 'worker.js'), 'w', encoding='utf-8') as f:
    f.write(out)
print('worker.js generated:', os.path.getsize(os.path.join(BASE, 'worker.js')), 'bytes')
