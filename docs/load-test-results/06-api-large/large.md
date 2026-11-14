## Large documents (topology A) [ok]

Started 2026-11-14T06:34:25.099Z, ended 2026-11-14T06:35:02.115Z.

```json
{
 "targetsKiB": [
  5,
  100,
  1024,
  5120
 ],
 "measure": "Yjs state size (encodeStateAsUpdate), not attached files",
 "productLimitBytes": 8388608
}
```

### Results

```json
{
 "documents": [
  {
   "targetKiB": 5,
   "seed": {
    "ok": true,
    "stateBytes": 5358,
    "batches": 22,
    "ms": 69.67578125,
    "paragraphs": 24
   },
   "seedSeconds": 8.8,
   "freshClientOpen": [
    {
     "ms": 28.29150390625,
     "stateBytes": 5358,
     "blocks": 24
    },
    {
     "ms": 36.490966796875,
     "stateBytes": 5358,
     "blocks": 24
    },
    {
     "ms": 34.6953125,
     "stateBytes": 5358,
     "blocks": 24
    },
    {
     "ms": 34.291259765625,
     "stateBytes": 5358,
     "blocks": 24
    },
    {
     "ms": 24.46337890625,
     "stateBytes": 5358,
     "blocks": 24
    }
   ],
   "exportJsonMs": 4.6,
   "serverRssMbBefore": {
    "4450": {
     "cpuPct": 85.8709112895093,
     "rssMb": 807.125
    }
   },
   "serverRssMbAfter": {
    "4450": {
     "cpuPct": 0.7998088119420167,
     "rssMb": 807.125
    }
   }
  },
  {
   "targetKiB": 100,
   "seed": {
    "ok": true,
    "stateBytes": 103107,
    "batches": 17,
    "ms": 85.046630859375,
    "paragraphs": 427
   },
   "seedSeconds": 8.8,
   "freshClientOpen": [
    {
     "ms": 27.667724609375,
     "stateBytes": 103107,
     "blocks": 427
    },
    {
     "ms": 33.385986328125,
     "stateBytes": 103107,
     "blocks": 427
    },
    {
     "ms": 35.18701171875,
     "stateBytes": 103107,
     "blocks": 427
    },
    {
     "ms": 36.18896484375,
     "stateBytes": 103107,
     "blocks": 427
    },
    {
     "ms": 36.86376953125,
     "stateBytes": 103107,
     "blocks": 427
    }
   ],
   "exportJsonMs": 8.7,
   "serverRssMbBefore": {
    "4450": {
     "cpuPct": 0.7998088119420167,
     "rssMb": 807.125
    }
   },
   "serverRssMbAfter": {
    "4450": {
     "cpuPct": 0.20000823009865779,
     "rssMb": 808.390625
    }
   }
  },
  {
   "targetKiB": 1024,
   "seed": {
    "ok": true,
    "stateBytes": 1147327,
    "batches": 11,
    "ms": 131.60791015625,
    "paragraphs": 1102
   },
   "seedSeconds": 9,
   "freshClientOpen": [
    {
     "ms": 62.775146484375,
     "stateBytes": 1147327,
     "blocks": 1102
    },
    {
     "ms": 49.4794921875,
     "stateBytes": 1147327,
     "blocks": 1102
    },
    {
     "ms": 48.18505859375,
     "stateBytes": 1147327,
     "blocks": 1102
    },
    {
     "ms": 53.056640625,
     "stateBytes": 1147327,
     "blocks": 1102
    },
    {
     "ms": 56.102294921875,
     "stateBytes": 1147327,
     "blocks": 1102
    }
   ],
   "exportJsonMs": 24.6,
   "serverRssMbBefore": {
    "4450": {
     "cpuPct": 0.20000823009865779,
     "rssMb": 808.390625
    }
   },
   "serverRssMbAfter": {
    "4450": {
     "cpuPct": 11.399252325319834,
     "rssMb": 808.74609375
    }
   }
  },
  {
   "targetKiB": 5120,
   "seed": {
    "ok": true,
    "stateBytes": 5328347,
    "batches": 51,
    "ms": 1042.27685546875,
    "paragraphs": 5102
   },
   "seedSeconds": 10.4,
   "freshClientOpen": [
    {
     "ms": 109.386962890625,
     "stateBytes": 5328347,
     "blocks": 5102
    },
    {
     "ms": 174.434814453125,
     "stateBytes": 5328347,
     "blocks": 5102
    },
    {
     "ms": 104.25390625,
     "stateBytes": 5328347,
     "blocks": 5102
    },
    {
     "ms": 135.7587890625,
     "stateBytes": 5328347,
     "blocks": 5102
    },
    {
     "ms": 102.98583984375,
     "stateBytes": 5328347,
     "blocks": 5102
    }
   ],
   "exportJsonMs": 111.4,
   "serverRssMbBefore": {
    "4450": {
     "cpuPct": 11.399252325319834,
     "rssMb": 808.74609375
    }
   },
   "serverRssMbAfter": {
    "4450": {
     "cpuPct": 27.596747110705262,
     "rssMb": 895.79296875
    }
   }
  }
 ],
 "systemWholeScenario": {
  "samples": 7,
  "host": {
   "load1Max": 7,
   "availableMbMin": 29074.1,
   "swapUsedMbMax": 17514.7
  },
  "server": {
   "4450": {
    "cpuPctAvg": 10.9,
    "cpuPctMax": 31.6,
    "rssMbMax": 895.8
   }
  },
  "postgres": {
   "cpuPctAvg": 4.6,
   "cpuPctMax": 18.3,
   "memMbMax": 181,
   "commitsPerSecond": 105.5,
   "rollbacksPerSecond": 0,
   "rowsInsertedPerSecond": 341.8,
   "walMbPerSecond": 0.7,
   "blockReadMs": 0,
   "blockWriteMs": 8.9,
   "deadlocks": 0,
   "backendsMax": 11,
   "activeMax": 0,
   "waitingOnLocksMax": 0
  }
 }
}
```