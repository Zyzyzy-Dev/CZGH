import test from 'node:test';
import assert from 'node:assert/strict';
import { profileRequest, authorizeLocalRequest } from '../src/planning/profiles.js';

test('TT local key uses explicit per-request credentials, without a host secret lookup or active-key fallback',()=>{
    for(const format of [undefined,'openai_compat','claude_messages','openai_responses','gemini_generate_content','gemini_interactions']){
        const profile={source:'custom',model:'m',keyRef:'local-1',connection:{custom_url:'https://example.org/v1',custom_api_format:format},additional:{custom_include_headers:'{"X-Test":"yes"}'}};
        const body=profileRequest(profile,[],100,JSON.parse),before=structuredClone(body);
        const request=authorizeLocalRequest(body,' test-local-key ',JSON.parse,{tauriTavern:true});
        assert.equal(request.custom_url,'');assert.equal(request.reverse_proxy,'https://example.org/v1');
        assert.equal(request.proxy_password,'test-local-key');assert.equal(request.secret_id,undefined);
        assert.equal(request.custom_api_format,format);
        assert.deepEqual(JSON.parse(request.custom_include_headers),{'X-Test':'yes'});
        assert.deepEqual(body,before);
        // Mirrors TT config.rs Custom branch: explicit proxy credentials skip read_optional_secret.
        let secretReads=0;
        const key=!request.custom_url&&request.reverse_proxy?request.proxy_password:(secretReads++,'wrong-active-key');
        assert.equal(key,'test-local-key');assert.equal(secretReads,0);
    }
});

test('local credentials override only authentication without falling back to the active native key',()=>{
    const profile={source:'custom',model:'m',keyRef:'local-1',connection:{custom_url:'https://example.org/v1'},additional:{custom_include_headers:'{"X-Test":"value"}'}};
    const body=profileRequest(profile,[],100,JSON.parse);
    const request=authorizeLocalRequest(body,'test-local-key',JSON.parse);
    assert.equal(request.secret_id,'czgh-local:local-1');
    assert.deepEqual(JSON.parse(request.custom_include_headers),{'X-Test':'value',Authorization:'Bearer test-local-key'});
    assert.equal(body.custom_include_headers,profile.additional.custom_include_headers);
    assert.throws(()=>authorizeLocalRequest(body,'',JSON.parse),/密钥/);
});
