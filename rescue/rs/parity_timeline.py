#!/usr/bin/env python3
"""Read-only Swift/Rust timeline parity. Raw HTTP bodies remain untouched.

record: capture full/frameless run, four exact frames and tracks per scenario.
import: reuse coordinator golden/_timings.txt without rewriting their bodies.
compare: strict status + byte comparison, optionally through an offline handler.
No skipped keys, numeric tolerance, sorting or timestamp normalization.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SCENARIOS = ('zawrat', 'morskie-oko', 'rodzina-dziecko-las')


def sha(body):
    return hashlib.sha256(body).hexdigest()


def fixture_name(path):
    # Same convention as parity.py. Manifest keeps the unambiguous original URL.
    return path.lstrip('/').translate(str.maketrans('/?&=', '____')) + '.json'


def schema_for(path):
    u = urllib.parse.urlsplit(path)
    if u.path.startswith('/api/tracks/'):
        return 'rescue-tracks-est/1'
    return 'rescue-frame/1' if 't' in dict(urllib.parse.parse_qsl(u.query)) else 'rescue-run/1'


def validate(path, status, body):
    if status != 200:
        raise ValueError(f'{path}: HTTP {status}, not a usable reference')
    data = json.loads(body)
    expected = schema_for(path)
    if data.get('schema') != expected:
        raise ValueError(f'{path}: expected {expected}, got {data.get("schema")}')
    if expected == 'rescue-run/1' and not data.get('timeline'):
        raise ValueError(f'{path}: missing timeline')
    if expected == 'rescue-frame/1':
        for key in ('minute', 't', 'actors', 'cov', 'poaGrid'):
            if key not in data:
                raise ValueError(f'{path}: missing frame.{key}')


def default_paths(scenario_dir):
    paths = []
    for sc in SCENARIOS:
        data = json.loads((scenario_dir / (sc + '.json')).read_bytes())
        clocks = list(dict.fromkeys([data['startClock']] + [e['at'] for e in data['events']]))
        clocks = [t for t in clocks if re.fullmatch(r'\d{2}:\d{2}', t)]
        if len(clocks) < 4:
            raise ValueError(f'{sc}: need at least four distinct scenario clocks')
        selected = [clocks[i] for i in (0, len(clocks) // 4, len(clocks) // 2, len(clocks) - 1)]
        paths += [f'/api/run/{sc}?live=0', f'/api/run/{sc}?live=0&frames=0']
        for t in selected:
            paths.append(f'/api/run/{sc}?' + urllib.parse.urlencode({'live': '0', 't': t}))
            paths.append(f'/api/tracks/{sc}?' + urllib.parse.urlencode({'at': t}))
    return paths


def fetch(base, path, timeout, pin_env=None):
    headers = {'Accept-Encoding': 'identity'}
    if pin_env:
        pin = os.environ.get(pin_env)
        if not pin:
            raise ValueError(f'Environment variable {pin_env} is empty')
        headers['X-Rescue-Pin'] = pin
    request = urllib.request.Request(base.rstrip('/') + path, headers=headers)
    start = time.perf_counter()
    try:
        response = urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body, status = response.read(), response.status
    return status, body, round((time.perf_counter() - start) * 1000, 2)


def offline(command, path, timeout):
    u = urllib.parse.urlsplit(path)
    request = {'path': u.path, 'query': dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))}
    start = time.perf_counter()
    process = subprocess.run([str(command)], input=json.dumps(request).encode(),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=True)
    envelope = json.loads(process.stdout)
    return int(envelope['status']), envelope['body'].encode('utf-8'), round((time.perf_counter() - start) * 1000, 2)


def difference(want_status, want, status, got):
    if want_status != status:
        return f'HTTP {want_status} != {status}'
    if want == got:
        return None
    offset = next((i for i, (a, b) in enumerate(zip(want, got)) if a != b), min(len(want), len(got)))
    try:
        equal_values = json.loads(want) == json.loads(got)
    except (ValueError, UnicodeError):
        equal_values = False
    hint = 'values equal; key order/number spelling/escaping/whitespace differs' if equal_values else 'JSON values differ'
    return f'byte {offset}, {len(want)} != {len(got)} bytes; {hint}'


def coverage(paths):
    result = {}
    for sc in SCENARIOS:
        own = [p for p in paths if urllib.parse.urlsplit(p).path.endswith('/' + sc)]
        result[sc] = {
            'runs': sum(schema_for(p) == 'rescue-run/1' for p in own),
            'frames': sum(schema_for(p) == 'rescue-frame/1' for p in own),
            'tracks': sum(schema_for(p) == 'rescue-tracks-est/1' for p in own),
        }
    complete = all(v['runs'] >= 2 and v['frames'] >= 4 and v['tracks'] >= 4 for v in result.values())
    return result, complete


def record(args):
    if args.golden.exists():
        raise ValueError('Reference directory already exists; choose a new directory')
    paths = default_paths(args.scenario_dir)
    cases = []
    # Fetch and validate everything before writing a reference manifest.
    bodies = []
    for path in paths:
        status, body, ms = fetch(args.url, path, args.timeout, args.pin_env)
        validate(path, status, body)
        bodies.append((path, status, body, ms))
        print(f'record {ms:8.2f}ms {path}')
    args.golden.mkdir(parents=True)
    for path, status, body, ms in bodies:
        filename = fixture_name(path)
        (args.golden / filename).write_bytes(body)
        cases.append({'path': path, 'status': status, 'file': filename, 'sha256': sha(body), 'ms': ms})
    manifest = {'schema': 'rescue-timeline-parity/1', 'reference': args.label, 'cases': cases}
    (args.golden / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'{len(cases)} exact Swift response bodies recorded')


def import_legacy(args):
    if args.golden.exists():
        raise ValueError('Reference directory already exists; choose a new directory')
    cases, bodies = [], []
    for line in (args.source / '_timings.txt').read_text().splitlines():
        code, timing, path = line.split(' ', 2)
        path = path.strip()
        u = urllib.parse.urlsplit(path)
        if u.path not in {f'/api/{kind}/{sc}' for kind in ('run', 'tracks') for sc in SCENARIOS}:
            continue
        body = (args.source / fixture_name(path)).read_bytes()
        validate(path, int(code), body)
        cases.append({'path': path, 'status': int(code), 'file': fixture_name(path), 'sha256': sha(body),
                      'ms': float(timing.removesuffix('ms'))})
        bodies.append((fixture_name(path), body))
    if not cases:
        raise ValueError('No matching reference requests')
    args.golden.mkdir(parents=True)
    for filename, body in bodies:
        (args.golden / filename).write_bytes(body)
    (args.golden / 'manifest.json').write_text(json.dumps({
        'schema': 'rescue-timeline-parity/1', 'reference': args.label, 'cases': cases}, indent=2) + '\n')
    print(f'Imported {len(cases)} untouched Swift bodies; coverage {coverage([c["path"] for c in cases])[0]}')


def compare(args):
    manifest = json.loads((args.golden / 'manifest.json').read_bytes())
    if manifest.get('schema') != 'rescue-timeline-parity/1' or not manifest.get('cases'):
        raise ValueError('Invalid or empty reference manifest')
    results = []
    for case in manifest['cases']:
        want = (args.golden / case['file']).read_bytes()
        if sha(want) != case['sha256']:
            raise ValueError(f'Reference checksum changed: {case["file"]}')
        path = case['path']
        try:
            status, got, ms = (offline(args.command, path, args.timeout) if args.command else
                               fetch(args.url, path, args.timeout, args.pin_env))
            error = difference(case['status'], want, status, got)
            result = {'path': path, 'status': status, 'ms': ms, 'sha256': sha(got), 'pass': error is None}
            if error:
                result['difference'] = error
                if args.report:
                    args.report.mkdir(parents=True, exist_ok=True)
                    (args.report / case['file']).write_bytes(got)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            result = {'path': path, 'pass': False, 'error': str(error)}
        results.append(result)
        print(('PASS ' if result['pass'] else 'FAIL ') + path + (' - ' + result.get('difference', result.get('error', '')) if not result['pass'] else ''))
    counts, complete = coverage([c['path'] for c in manifest['cases']])
    report = {'reference': manifest['reference'], 'transport': 'offline-handler' if args.command else 'HTTP',
              'coverage': counts, 'complete': complete, 'results': results,
              'passed': sum(r['pass'] for r in results), 'total': len(results)}
    if args.report:
        args.report.mkdir(parents=True, exist_ok=True)
        (args.report / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'{report["passed"]}/{len(results)} byte-identical; coverage {"complete" if complete else "PARTIAL (missing exact frames/tracks)"}')
    return 1 if report['passed'] != len(results) else 0 if complete else 2


def self_test():
    body = b'{"a":1,"path":"a\\/b","z":false}'
    assert difference(200, body, 200, body) is None
    for changed in (b'{"z":false,"a":1,"path":"a\\/b"}', body.replace(b'1,', b'1.0,'),
                    body.replace(b'\\/', b'/'), body.replace(b'false', b'true')):
        assert difference(200, body, 200, changed) is not None
    assert difference(200, body, 401, body) is not None
    paths = default_paths(Path(__file__).resolve().parents[1] / 'scenarios')
    assert len(paths) == len(set(paths)) == 30
    assert coverage(paths)[1] and not coverage(['/api/run/zawrat?live=0'])[1]
    assert len({fixture_name(p) for p in paths}) == len(paths)
    print('PASS: exact bytes, order, numeric spelling, slash escaping, values, HTTP status and full/partial coverage')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    for mode in ('record', 'import', 'compare'):
        p = sub.add_parser(mode)
        p.add_argument('--golden', type=Path, required=True)
        p.add_argument('--label', default='Swift reference')
        if mode == 'import':
            p.add_argument('--source', type=Path, required=True)
        else:
            if mode == 'record':
                p.add_argument('--url', required=True)
                p.add_argument('--scenario-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'scenarios')
            else:
                source = p.add_mutually_exclusive_group(required=True)
                source.add_argument('--url')
                source.add_argument('--command', type=Path, help='Offline handler: request JSON on stdin, status/body JSON on stdout')
                p.add_argument('--report', type=Path)
            p.add_argument('--timeout', type=float, default=120)
            p.add_argument('--pin-env', help='Optional environment variable containing a LAN read key; never stored')
    sub.add_parser('self-test')
    args = parser.parse_args()
    try:
        if args.mode == 'record': record(args)
        elif args.mode == 'import': import_legacy(args)
        elif args.mode == 'compare': return compare(args)
        else: self_test()
        return 0
    except (OSError, ValueError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
