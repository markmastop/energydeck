#!/usr/bin/env python3
"""Preview/install measured price control in the existing Sessy - Run Flow.

Default is read-only. --apply is an explicit real-control activation; backups
include the previous Flow/script/flag so rollback restores the exact controller.
"""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import urllib.request
from datetime import datetime, timezone

sys.dont_write_bytecode = True
from homey_discover import HomeyClient, load_env, values
ROOT = Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('reserve_installer',ROOT/'scripts/install-sessy-ready-by-17.py')
reserve=importlib.util.module_from_spec(spec);spec.loader.exec_module(reserve)

def bundle(env):
    tariff={key:float(env.get(name,default)) for key,name,default in [
        ('tax','ENERGYDECK_ENERGY_TAX_EX_VAT_CT','9.161'),('vat','ENERGYDECK_VAT_PERCENT','21'),('fee','ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT','2')]}
    base=reserve.price_plan_bundle(env['HOMEY_PRICES_VARIABLE_ID'],env['HOMEY_CHARGER_DEVICE_ID'],tariff)
    measured=(ROOT/'homeyscript/sessy-measured-inputs.mjs').read_text().replace("import {sessyTarget} from './sessy-price-planner.mjs';",'').replace('export function ','function ')
    active=(ROOT/'homeyscript/sessy-price-active.js').read_text()
    for key,env_key in [('GRID','HOMEY_HOMEWIZARD_DEVICE_ID'),('SOLAR','HOMEY_SOLAR_DEVICE_ID'),('CHARGER','HOMEY_CHARGER_DEVICE_ID'),('PRICES_VARIABLE','HOMEY_PRICES_VARIABLE_ID')]:
        active=active.replace("'__SESSY_"+key+"_ID__'",json.dumps(env[env_key]))
        # Device placeholders explicitly contain DEVICE in their names.
        active=active.replace("'__SESSY_"+key+"_DEVICE_ID__'",json.dumps(env[env_key]))
    active=active.replace('__SESSY_TARIFF__',json.dumps(tariff))
    source=base+measured+'\n'+active+'\n'+(ROOT/'homeyscript/sessy-price-controller.js').read_text()
    return reserve.named_script_source(source,env['HOMEY_SESSY_DEVICE_ID'])

def without_price_gate(flow, price_id):
    result=copy.deepcopy(flow)
    gates=[(k,c) for k,c in result['cards'].items() if c.get('id')=='homey:manager:logic:contains'
        and c.get('droptoken')=='homey:manager:logic|'+price_id and c.get('args')=={'comparator':'C'}]
    if len(gates)!=1:raise ValueError('Expected exactly one verified legacy category-C price gate')
    key,gate=gates[0]
    if not gate.get('outputFalse') or not gate.get('outputTrue'):raise ValueError('Incomplete legacy price gate')
    changed=0
    for card in result['cards'].values():
        for output in ['outputTrue','outputFalse','outputSuccess','outputError']:
            if key in card.get(output,[]):
                card[output]=[replacement for target in card[output] for replacement in (gate['outputFalse'] if target==key else [target])]
                changed+=1
    if changed!=1:raise ValueError('Unexpected legacy price gate topology')
    del result['cards'][key]
    return result,key

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--restore',type=Path)
    parser.add_argument('--main-fuse-amps',type=int,default=25)
    parser.add_argument('--sessy-phase',type=int,choices=[1,2,3],default=3)
    args=parser.parse_args();load_env()
    if args.main_fuse_amps!=25:raise ValueError('This deployment was reviewed for the confirmed 3x25 A connection')
    client=HomeyClient(os.environ['HOMEY_ADDRESS'].rstrip('/'),os.environ['HOMEY_TOKEN'])
    def write(method,path,body):
        request=urllib.request.Request(client.address+path,method=method,data=json.dumps(body).encode(),
            headers={'Authorization':'Bearer '+client.token,'Content-Type':'application/json','Accept':'application/json'})
        with urllib.request.urlopen(request,timeout=45,context=client.ssl_context) as response:
            raw=response.read();return json.loads(raw) if raw else None
    def body(flow):return {k:flow[k] for k in ['name','folder','enabled','cards'] if k in flow}
    def script_body(script):return {k:script[k] for k in ['name','code','version'] if k in script}
    variables=list(values(client.get('/api/manager/logic/variable')))
    def lookup(name,kind):
        found=[v for v in variables if v['name']==name]
        if len(found)>1 or found and found[0]['type']!=kind:raise ValueError('Ambiguous variable '+name)
        return found[0] if found else None
    if args.restore:
        backup=json.loads(args.restore.read_text());print('Rollback:',backup['flow']['name'])
        if not args.apply:return
        flag=lookup('sessy_price_plan_enabled','boolean')
        if flag:write('PUT','/api/manager/logic/variable/'+flag['id'],{'value':False})
        write('PUT','/api/app/com.athom.homeyscript/script/'+backup['script']['id'],script_body(backup['script']))
        write('PUT','/api/manager/flow/advancedflow/'+backup['flow']['id'],body(backup['flow']))
        if client.get('/api/app/com.athom.homeyscript/script/'+backup['script']['id']).get('code')!=backup['script']['code']:raise RuntimeError('Rollback script verification failed')
        if body(client.get('/api/manager/flow/advancedflow/'+backup['flow']['id']))!=body(backup['flow']):raise RuntimeError('Rollback verification failed')
        if flag and backup.get('flag'):write('PUT','/api/manager/logic/variable/'+flag['id'],{'value':backup['flag']['value']})
        print('Exact previous Flow/script restored; active flag restored.');return
    flows=[f for f in values(client.get('/api/manager/flow/advancedflow')) if f['name']=='Sessy - Run' and f.get('enabled')]
    scripts=[s for s in values(client.get('/api/app/com.athom.homeyscript/script')) if s['name']==reserve.SCRIPT_NAME]
    if len(flows)!=1 or len(scripts)!=1:raise ValueError('Expected one enabled Flow and one existing named controller')
    flow=flows[0];script=client.get('/api/app/com.athom.homeyscript/script/'+scripts[0]['id'])
    if 'Installed as "Sessy - Laadplan"' not in script.get('code',''):raise ValueError('Unknown existing controller source')
    normal=[c for c in flow['cards'].values() if c.get('id')=='homey:app:com.athom.homeyscript:runWithArg' and
        c.get('args',{}).get('script',{}).get('id')==script['id'] and c.get('args',{}).get('argument')=='control']
    if len(normal)!=1:raise ValueError('Expected one existing normal-control invocation')
    price=lookup('kwh_prijs_categorie','string')
    existing_gate=any(c.get('id')=='homey:manager:logic:contains' and c.get('droptoken')=='homey:manager:logic|'+price['id'] for c in flow['cards'].values())
    if '/* Active normal-control step.' in script['code'] and not existing_gate:
        patched,gate=copy.deepcopy(flow),None  # Source-only upgrade of our installed active controller.
    else:
        patched,gate=without_price_gate(flow,price['id'])
    owners={c.get('ownerUri') for c in flow['cards'].values() if c.get('id','').endswith(':set_power_setpoint')}
    if owners!={'homey:device:'+os.environ['HOMEY_SESSY_DEVICE_ID']}:raise ValueError('Actuator identity mismatch')
    source=bundle(os.environ)
    print('Measured week profile; 5 kWh, 1 kW grid / 1.8 kW discharge, 3x25 A, phase',args.sessy_phase,'with 2 A margin.')
    print('Only legacy price-gate bypass; manual, EV, SoC, error-stop and actuator cards preserved.')
    if not args.apply:print('Read-only preview. --apply installs and enables actual price control.');return
    flag=lookup('sessy_price_plan_enabled','boolean')
    backup={'flow':flow,'script':script,'flag':flag}
    directory=ROOT/'build/homey-backups';directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    path=directory/('sessy-before-active-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json')
    with open(path,'x',opener=lambda p,f:os.open(p,f,0o600)) as out:json.dump(backup,out)
    print('Private rollback backup:',path)
    def ensure(name,kind,value):
        v=lookup(name,kind)
        return v or write('POST','/api/manager/logic/variable',{'name':name,'type':kind,'value':value})
    flag=ensure('sessy_price_plan_enabled','boolean',False)
    profile=ensure('sessy_price_profile','string','{}')
    config=ensure('sessy_price_config','string','{}')
    write('PUT','/api/manager/logic/variable/'+flag['id'],{'value':False})
    write('PUT','/api/manager/logic/variable/'+config['id'],{'value':json.dumps({'version':1,'phases':3,'fuseA':25,'phase':args.sessy_phase,'marginA':2,'confirmed':'user'})})
    script_path='/api/app/com.athom.homeyscript/script/'+script['id'];flow_path='/api/manager/flow/advancedflow/'+flow['id']
    try:
        write('PUT',script_path,{**script_body(script),'code':source})
        if client.get(script_path).get('code')!=source:raise RuntimeError('Controller source read-back mismatch')
        preview=write('POST',script_path+'/run',{'args':['preview-active']})
        result=preview.get('returns',{});proposal=result.get('proposal') or {}
        if not preview.get('success') or result.get('writesApplied')!=0 or result.get('preview') is not True or proposal.get('mode')!='active' or proposal.get('inputQuality')!='calibrated' or not proposal.get('quarters'):
            raise RuntimeError('Active preview failed: '+json.dumps({'success':preview.get('success'),'error':preview.get('error'),'controller':result.get('controller'),'proposal':proposal and {k:proposal.get(k) for k in ['mode','inputQuality','quarters']}}))
        if body(client.get(flow_path))!=body(flow):raise RuntimeError('Flow changed during installation')
        write('PUT',flow_path,body(patched))
        actual=client.get(flow_path)
        if body(actual)!=body(patched) or actual.get('broken'):raise RuntimeError('Flow read-back mismatch')
        write('PUT','/api/manager/logic/variable/'+flag['id'],{'value':True})
        if client.get('/api/manager/logic/variable/'+flag['id']).get('value') is not True:raise RuntimeError('Enable read-back failed')
    except Exception:
        write('PUT','/api/manager/logic/variable/'+flag['id'],{'value':False})
        write('PUT',script_path,script_body(script));write('PUT',flow_path,body(flow))
        if backup['flag']:write('PUT','/api/manager/logic/variable/'+flag['id'],{'value':backup['flag']['value']})
        raise
    print('Verified active preview (zero writes), exact Flow patch and enabled flag. Existing 10-second loop executes control; no Flow was manually triggered.')

if __name__=='__main__':main()
