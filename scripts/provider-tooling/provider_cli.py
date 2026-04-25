#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import time
from pathlib import Path

ROOT = Path('/home/.paperclip/provider-tooling')
POLICY = ROOT / 'provider-governance.json'
GATE = ROOT / 'provider_gate.py'
COMPANIES = ['PER', 'KUR', 'GAT', 'LOV', 'PAR', 'EMD', 'TRT', 'AII']


def load():
    return json.loads(POLICY.read_text())


def save(data):
    backup = ROOT / 'backups' / time.strftime('%Y%m%dT%H%M%SZ')
    backup.mkdir(parents=True, exist_ok=True)
    shutil.copy2(POLICY, backup / 'provider-governance.json')
    POLICY.write_text(json.dumps(data, indent=2) + '\n')
    print(f'updated {POLICY}; backup={backup}')


def run_provider(provider, company, cmd):
    if company not in COMPANIES:
        raise SystemExit(f"unknown company {company}; choose one of {', '.join(COMPANIES)}")
    os.execvp('python3', ['python3', str(GATE), '--provider', provider, '--company', company, '--', *cmd])


def print_policy(provider=None, company=None):
    data = load()['providers']
    providers = [provider] if provider else sorted(data)
    out = {}
    for pv in providers:
        if pv not in data:
            raise SystemExit(f'unknown provider {pv}')
        entry = data[pv]
        if company:
            out[pv] = {company: entry.get('companies', {}).get(company)}
        else:
            out[pv] = entry
    print(json.dumps(out, indent=2))


def scope(args):
    data = load()
    pv = data.setdefault('providers', {}).setdefault(args.provider, {'runtime': {}, 'companies': {}})
    cp = pv.setdefault('companies', {}).setdefault(args.company, {})
    cp['mode'] = 'deny' if args.deny else 'scoped'
    if args.classes:
        cp['allowedCommandClasses'] = [x.strip() for x in args.classes.split(',') if x.strip()]
    if args.toolkits:
        cp['allowedToolkits'] = [x.strip().replace('-', '_').lower() for x in args.toolkits.split(',') if x.strip()]
    if args.usecase:
        cp.setdefault('allowedUsecases', []).append(args.usecase)
    if args.forbid:
        cp.setdefault('forbiddenUsecases', []).append(args.forbid)
    save(data)


def quickstart(company):
    print(f'''Paperclip provider connection quickstart for {company}

Inspect scope:
  paperclip-connections policy show --company {company}

Zapier SDK:
  paperclip-connections zapier --company {company} -- get-profile
  paperclip-connections zapier --company {company} -- list-connections
  paperclip-connections zapier --company {company} -- run-action <app-action> --connection-id <id> --inputs '{{...}}' --json

Composio CLI:
  paperclip-connections composio --company {company} -- whoami
  paperclip-connections composio --company {company} -- login
  paperclip-connections composio --company {company} -- link gmail
  paperclip-connections composio --company {company} -- connections list
  paperclip-connections composio --company {company} -- search "send email" --toolkits gmail --limit 5
  paperclip-connections composio --company {company} -- execute GMAIL_SEND_EMAIL --dry-run --get-schema

Grant a new toolkit/class scope:
  paperclip-connections scope grant --provider composio --company {company} --classes identity,catalog,connection-read,credentials-mutate,action-run,workflow-run --toolkits gmail,github,slack
''')


def main():
    p = argparse.ArgumentParser(description='Easy scoped Paperclip provider connections: Zapier SDK + Composio CLI')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('companies')

    pol = sub.add_parser('policy')
    polsub = pol.add_subparsers(dest='policy_cmd', required=True)
    show = polsub.add_parser('show')
    show.add_argument('--provider')
    show.add_argument('--company')

    sc = sub.add_parser('scope')
    scsub = sc.add_subparsers(dest='scope_cmd', required=True)
    gr = scsub.add_parser('grant')
    gr.add_argument('--provider', required=True, choices=['cloudflare', 'zapier', 'stripe', 'composio'])
    gr.add_argument('--company', required=True, choices=COMPANIES)
    gr.add_argument('--classes')
    gr.add_argument('--toolkits')
    gr.add_argument('--usecase')
    gr.add_argument('--forbid')
    gr.add_argument('--deny', action='store_true')

    qs = sub.add_parser('quickstart')
    qs.add_argument('--company', required=True, choices=COMPANIES)

    for provider in ['zapier', 'composio', 'cloudflare', 'stripe']:
        sp = sub.add_parser(provider)
        sp.add_argument('--company', required=True, choices=COMPANIES)
        sp.add_argument('provider_args', nargs=argparse.REMAINDER)

    args = p.parse_args()
    if args.cmd == 'companies':
        print('\n'.join(COMPANIES))
        return
    if args.cmd == 'policy':
        print_policy(args.provider, args.company)
        return
    if args.cmd == 'scope':
        scope(args)
        return
    if args.cmd == 'quickstart':
        quickstart(args.company)
        return

    cmd = args.provider_args[1:] if args.provider_args and args.provider_args[0] == '--' else args.provider_args
    if not cmd:
        raise SystemExit('provider command missing after --')
    run_provider(args.cmd, args.company, cmd)


if __name__ == '__main__':
    main()