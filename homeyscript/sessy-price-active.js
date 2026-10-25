// Bundled with canonical chart prices, the pure optimiser and measured-input model.
async function activeSessyStep(variables, now, deviceId, previous) {
  const epoch=Math.floor(now.getTime()/1000),find=name=>variables.find(v=>v.name===name);
  const parse=raw=>{try{return JSON.parse(raw);}catch(_){return null;}};
  const config=parse(find('sessy_price_config')?.value);
  const [battery,grid,charger]=await Promise.all([
    Homey.devices.getDevice({id:deviceId}),
    Homey.devices.getDevice({id:'__SESSY_GRID_DEVICE_ID__'}),
    Homey.devices.getDevice({id:'__SESSY_CHARGER_DEVICE_ID__'}),
  ].map(p=>p.catch(()=>null)));
  const state=sessyLiveState(battery,grid,charger,config,epoch);
  let profile=parse(find('sessy_price_profile')?.value),profileFailure=false;
  const validProfile=p=>p?.version===1&&p.source==='homey-insights'&&p.basis==='gross-house-excluding-ev'&&
    p.updatedAt<=epoch+30&&p.updatedAt>=epoch-7200&&p.last>=epoch-10800&&p.samples>=72&&
    Array.isArray(p.bins)&&p.bins.length===2&&p.bins.every(day=>Array.isArray(day)&&day.length===24&&
      day.every(b=>['houseW','evW','phaseW'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])&&b[k]>=0&&b[k]<=30000)&&b.samples>=2));
  if (!validProfile(profile)||epoch-profile.updatedAt>=3600) {
    try {
      const logs={},requests=[['grid','__SESSY_GRID_DEVICE_ID__','energy_power'],['battery',deviceId,'energy_power'],
        ['pv','__SESSY_SOLAR_DEVICE_ID__','energy_power'],['ev','__SESSY_CHARGER_DEVICE_ID__','energy_power'],
        ['phase','__SESSY_GRID_DEVICE_ID__','measure_power.l'+config?.phase]];
      for (const [key,id,cap] of requests) {
        const uri='homey:device:'+id;
        logs[key]=await Homey.insights.getLogEntries({uri,id:uri+':'+cap,resolution:'last7Days'});
      }
      profile=buildSessyProfile(logs,epoch);
      const variable=find('sessy_price_profile');
      if (variable) await Homey.logic.updateVariable({id:variable.id,variable:{value:JSON.stringify(profile)}});
    } catch (_) {profileFailure=!validProfile(profile);}
  }
  let plan=null,reason=profileFailure?'history-unavailable':'prices-unavailable';
  const bridge=parse(variables.find(v=>v.id==='__SESSY_PRICES_VARIABLE_ID__')?.value);
  const wearCt=config?.wearCt??3;
  const configOK=config?.version===1&&config.phases===3&&config.fuseA===25&&config.marginA>=2&&config.marginA<10&&[1,2,3].includes(config.phase)&&
    typeof wearCt==='number'&&Number.isFinite(wearCt)&&wearCt>=0&&wearCt<=100;
  if (validProfile(profile)&&configOK&&bridge&&Number.isFinite(state.soc)&&state.soc>=0&&state.soc<=100) {
    const sun=parse(find('sessy_sunshine_forecast')?.value);
    let hash=2166136261;
    for (const char of JSON.stringify([bridge,profile.updatedAt,config,sun?.updatedAt])) hash=Math.imul(hash^char.charCodeAt(0),16777619);
    const key=`${Math.floor(epoch/300)}:${Math.floor(state.soc)}:${state.ev}:${hash>>>0}`;
    if (previous?.mode==='active'&&previous.inputQuality==='calibrated'&&previous.inputKey===key&&previous.validUntil>epoch) plan=previous;
    else {
      const slots=[],fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',hour:'2-digit',weekday:'short',hourCycle:'h23'});
      for (const date of [localDay(now),localDay(now,1)]) {
        const day=priceDay(bridge,date,__SESSY_TARIFF__);
        if (!day||day.source==='unknown') break;
        for (let i=0;i<day.values.length;i++) {
          const from=Math.max(epoch,day.start/1000+i*900),until=day.start/1000+(i+1)*900;
          if (until<=epoch||until>epoch+129600) continue;
          const c=Object.fromEntries(fmt.formatToParts(new Date(from*1000)).map(p=>[p.type,p.value]));
          const b=profile.bins[['Sat','Sun'].includes(c.weekday)?1:0][Number(c.hour)];
          const q={from,until,price:day.values[i],houseW:b.houseW,pvW:0,
            ev:slots.length?b.evW>50:state.ev,
            headroomW:Math.max(0,(config.fuseA-config.marginA)*220-b.phaseW-b.evW/3),sun:null};
          // Sunshine stays a separate visual signal. No invented sunshine->PV kWh.
          if (sun?.valid===true&&sun.source==='open-meteo'&&sun.updatedAt<=epoch+30&&sun.updatedAt>=epoch-4500) {
            const periods=Array.isArray(sun.forwardPeriods)&&sun.forwardPeriods.length<=145?sun.forwardPeriods:
              Array.isArray(sun.periods)&&sun.periods.length<=16?sun.periods:[];
            const p=periods.find(p=>p&&Number.isInteger(p.start)&&Number.isInteger(p.end)&&p.start<=from&&p.end>=until&&p.end-p.start===900);
            if (p&&typeof p.sunMinutes==='number'&&p.sunMinutes>=0&&p.sunMinutes<=15) q.sun=p.sunMinutes/15;
          }
          slots.push(q);
        }
      }
      if (slots.length) {
        plan=planSessy({now:epoch,soc:state.soc,slots,inputQuality:'calibrated',wearCt});
        plan.mode='active';plan.inputKey=key;
        plan.inputs={source:'homey-insights',samples:profile.samples,updatedAt:profile.updatedAt,
          forecast:'historical-hourly',pvForecast:'unknown',fuseA:config.fuseA,phase:config.phase,marginA:config.marginA,wearCt};
      }
    }
  }
  if (!configOK) reason='site-unconfirmed';
  const execution=executeSessyPlan(plan,state,epoch);
  if (!plan&&execution.reason==='plan-unavailable') execution.reason=reason;
  return {plan,execution};
}
