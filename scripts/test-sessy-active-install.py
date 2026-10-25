#!/usr/bin/env python3
import copy
import importlib.util
import subprocess
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('active',ROOT/'scripts/install-sessy-price-control.py')
active=importlib.util.module_from_spec(spec);spec.loader.exec_module(active)

class InstallTests(unittest.TestCase):
    def test_user_allowance_survives_source_updates(self):
        self.assertEqual(active.selected_wear(None),3)
        self.assertEqual(active.selected_wear({'value':'{"wearCt":1.5}'}),1.5)
        self.assertEqual(active.selected_wear({'value':'{"wearCt":1.5}'},0),0)
        for value in [True,-1,101,float('nan')]:
            with self.assertRaises(ValueError):active.selected_wear(None,value)
    def test_only_verified_price_gate_is_bypassed(self):
        flow={'name':'Sessy - Run','cards':{
          'guard':{'id':'permission','outputTrue':['price'],'outputFalse':['stop']},
          'price':{'id':'homey:manager:logic:contains','droptoken':'homey:manager:logic|category','args':{'comparator':'C'},'outputTrue':['stop'],'outputFalse':['discharge']},
          'discharge':{'id':'device:set_power_setpoint','args':{'setpoint':'target'}},
          'stop':{'id':'device:set_power_setpoint','args':{'setpoint':0}},
          'manual':{'id':'manual','outputSuccess':['discharge']}}}
        old=copy.deepcopy(flow);new,key=active.without_price_gate(flow,'category')
        self.assertEqual(flow,old);self.assertEqual(key,'price');self.assertNotIn('price',new['cards'])
        self.assertEqual(new['cards']['guard']['outputTrue'],['discharge'])
        for key in ['manual','stop','discharge']:self.assertEqual(new['cards'][key],old['cards'][key])
        with self.assertRaises(ValueError):active.without_price_gate(flow,'wrong-category')
        flow['cards']['manual']['outputSuccess']=['price']
        with self.assertRaises(ValueError):active.without_price_gate(flow,'category')

    def test_exact_active_bundle(self):
        env={'HOMEY_PRICES_VARIABLE_ID':'prices','HOMEY_CHARGER_DEVICE_ID':'charger','HOMEY_HOMEWIZARD_DEVICE_ID':'grid','HOMEY_SOLAR_DEVICE_ID':'pv','HOMEY_SESSY_DEVICE_ID':'battery'}
        source=active.bundle(env);self.assertNotIn('__SESSY_',source)
        subprocess.run(['node',str(ROOT/'scripts/test-sessy-active.mjs')],input=source,text=True,check=True)

if __name__=='__main__':unittest.main()
