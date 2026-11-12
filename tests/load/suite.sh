#!/usr/bin/env bash
# Sequential suite used for docs/load-test-report.md. Each line is one fresh stack.
. /home/techsphere/Documents/project/realtimedocs/scripts/dev-env.sh
cd /home/techsphere/Documents/project/realtimedocs/tests/load
R="node --import tsx src/run.ts"
run() { echo "### $*"; $R "$@" || echo "FAILED: $*"; }
case "$1" in
phase1) # topology A, default pool
  [ -f results/A-s1/s1.json ] || run s1 --topology A --out A-s1
  run s2 --topology A --out A-s2
  run s3 --topology A --out A-s3
  run s13 --topology A --out A-s13
  run s10 --topology A --out A-s10 ;;
phase2) # topology C: two instances + Redis behind the proxy
  run s1 --topology C --out C-s1
  run s2 --topology C --out C-s2
  run s3 --topology C --out C-s3
  run s13 --topology C --out C-s13
  run s10 --topology C --out C-s10 ;;
phase3) # restaged bundle, 4 generator workers (host load rule)
  W="--workers 4"
  run s13,s10,s8,s6 --topology A $W --out A-misc
  run s1 --topology C $W --out C-s1
  run s2 --topology C $W --duration 120 --out C-s2
  run s3 --topology C $W --duration 90 --out C-s3
  run s13,s10,s11,s14 --topology C $W --out C-resilience
  run s12,s15 --topology A $W --out A-s12-s15
  run s16 --topology A $W --minutes 12 --out A-s16 ;;
esac
