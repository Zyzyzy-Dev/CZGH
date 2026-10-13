import test from 'node:test';
import assert from 'node:assert/strict';
import { listProfiles, resolveProfile, profileRequest } from '../src/planning/profiles.js';
const profile = { id: 'one', name: '规划方案', source: 'custom', model: 'planner', secretId: 'key-one', connection: { custom_url: 'https://example.org/v1' }, additional: { custom_include_body: '{"temperature":0.7}', custom_exclude_body: '[]', custom_include_headers: '{"X-Test":"yes"}' } };
const settings = () => ({ preset_compare_api_manager: { version: 1, profiles: [structuredClone(profile)] } });

test('copied custom API format survives request construction and cannot be overridden by extra parameters',()=>{
    for(const format of ['openai_compat','openai_responses','claude_messages','gemini_interactions','gemini_generate_content']){
        const saved={...profile,connection:{...profile.connection,custom_api_format:format}};
        assert.equal(profileRequest(saved,[],1000,JSON.parse).custom_api_format,format);
    }
    assert.equal(Object.hasOwn(profileRequest(profile,[],1000,JSON.parse),'custom_api_format'),false);
    assert.throws(()=>profileRequest({...profile,connection:{...profile.connection,custom_api_format:'unknown'}},[],1000,JSON.parse),/格式/);
    assert.throws(()=>profileRequest({...profile,additional:{custom_include_body:'{"custom_api_format":"claude_messages"}'}},[],1000,JSON.parse),/覆盖/);
});
test('list safe profile metadata; resolve selected profile without modifying provider store', () => {
    const store = settings(), before = structuredClone(store);
    assert.deepEqual(listProfiles(store), [{ id: 'one', name: '规划方案', apiUrl: 'https://example.org/v1', model: 'planner' }]);
    const p = resolveProfile(store, 'one'); p.model = 'changed';
    assert.deepEqual(store, before);
    assert.throws(() => resolveProfile(store, 'deleted'));
    assert.throws(() => listProfiles({ preset_compare_api_manager: { version: 2, profiles: [] } }));
});
test('request uses explicit secret reference and preserves compatible extra parameters', () => {
    const messages = [{ role: 'user', content: 'context' }];
    const body = profileRequest(profile, messages, 8000, JSON.parse);
    assert.equal(body.secret_id, 'key-one'); assert.equal(body.model, 'planner');
    assert.equal(body.max_tokens, 8000); assert.equal(body.stream, false);
    assert.equal(body.custom_include_body, profile.additional.custom_include_body);
    assert.deepEqual(body.messages, messages);
    assert.throws(() => profileRequest({ ...profile, secretId: '' }, messages, 8000, JSON.parse));
    for (const additional of [{ custom_include_body: '{"messages":[]}' }, { custom_include_headers: '{"Authorization":"bad"}' }, { custom_exclude_body: '["model"]' }]) {
        assert.throws(() => profileRequest({ ...profile, additional }, messages, 8000, JSON.parse));
    }
});
