"""Run inside a one-CPU, memory-limited Linux container with /data read-only.

Measures the native numeric kernel only, not browser/PNG/service or whole-VM RAM.
"""
import json
import pathlib
import statistics
import struct
import subprocess
import time

root = pathlib.Path('/data')
rows = json.loads((root / 'dataset.json').read_text())
weights = (root / 'training/mlp.bin').read_bytes()
features = struct.pack('<96f', *rows[0]['features'])
payload = weights + features
latency = []
for _ in range(1000):
    start = time.monotonic()
    result = subprocess.run([str(root / 'visual-native')], input=payload, capture_output=True, timeout=10, check=True)
    if len(result.stdout) != 24:
        raise RuntimeError('invalid-output')
    latency.append((time.monotonic()-start)*1000)
cg = pathlib.Path('/sys/fs/cgroup')
print(json.dumps({
    'scope': 'native-kernel-and-python-driver-only; excludes-PNG-browser-server-OS',
    'jobs': len(latency), 'processPerJob': True,
    'p50Ms': statistics.median(latency), 'p95Ms': sorted(latency)[949], 'maxMs': max(latency),
    'memoryPeakBytes': int((cg / 'memory.peak').read_text()),
    'memoryMax': (cg / 'memory.max').read_text().strip(),
    'swapMax': (cg / 'memory.swap.max').read_text().strip(),
    'cpuMax': (cg / 'cpu.max').read_text().strip(),
    'memoryEvents': (cg / 'memory.events').read_text().strip(),
    'vpsQualified': False,
}, indent=2))
