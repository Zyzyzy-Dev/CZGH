import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbench } from '../src/host/workbench.js';

test('compact preset saves acknowledge without loading sources or API profiles; failed saves restore settings',async()=>{
    const context={extensionSettings:{}};let fail=false;
    Object.defineProperty(context.extensionSettings,'preset_compare_api_manager',{get(){throw Error('must not read API profiles');}});
    const workbench=createWorkbench({context:()=>context,headers:()=>({}),saveSettings:async()=>{if(fail)throw Error('save failed');}});
    assert.deepEqual(await workbench.execute('selection.update',{promptOverrides:{main:false},compact:true}),{selectionSaved:true});
    assert.equal(context.extensionSettings.czgh_external_planner.selection.promptOverrides.main,false);
    fail=true;
    await assert.rejects(workbench.execute('selection.update',{promptOverrides:{main:true},compact:true}),/save failed/);
    assert.equal(context.extensionSettings.czgh_external_planner.selection.promptOverrides.main,false);
    await assert.rejects(workbench.execute('selection.update',{promptOverrides:{main:'yes'},compact:true}),/布尔/);
});
