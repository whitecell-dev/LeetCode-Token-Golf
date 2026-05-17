// ==UserScript==
// @name         LeetCode Token Golf (Minimal)
// @namespace    http://tampermonkey.net/
// @version      0.4.0
// @description  Token efficiency tracker - brutally simple
// @match        https://leetcode.com/problems/*
// @match        https://leetcode.cn/problems/*
// @icon         data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">⛳</text></svg>
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ════════════════════════════════════════════════════════════
    // 🗑️ STORAGE (brutally simple)
    // ════════════════════════════════════════════════════════════
    
    function getAPIKey(provider) {
        return GM_getValue(`token_golf_key_${provider}`, null);
    }
    
    function setAPIKey(provider, key) {
        GM_setValue(`token_golf_key_${provider}`, key);
    }

    // ════════════════════════════════════════════════════════════
    // 📡 API CALLS (just working)
    // ════════════════════════════════════════════════════════════
    
    async function callGemini(prompt, apiKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7 }
                }),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.error) {
                            reject(new Error(data.error.message));
                            return;
                        }
                        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        const tokens = data.usageMetadata?.totalTokenCount || Math.ceil(text.length / 4);
                        resolve({ text, tokens });
                    } catch (e) {
                        reject(new Error('Failed to parse Gemini response'));
                    }
                },
                onerror: () => reject(new Error('Network error'))
            });
        });
    }
    
    async function callOpenAI(prompt, apiKey) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.openai.com/v1/chat/completions',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                data: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7
                }),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.error) {
                            reject(new Error(data.error.message));
                            return;
                        }
                        resolve({
                            text: data.choices[0].message.content,
                            tokens: data.usage?.total_tokens || 0
                        });
                    } catch (e) {
                        reject(new Error('Failed to parse OpenAI response'));
                    }
                },
                onerror: () => reject(new Error('Network error'))
            });
        });
    }

    // ════════════════════════════════════════════════════════════
    // 📝 EDITOR EXTRACTION (just works)
    // ════════════════════════════════════════════════════════════
    
    function getEditorContent() {
        // Monaco API
        try {
            const model = window.monaco?.editor?.getModels()?.[0];
            if (model) {
                const content = model.getValue();
                if (content && content.trim()) return content;
            }
        } catch (e) {}
        
        // DOM scraping
        const lines = document.querySelectorAll('.view-line');
        if (lines.length) {
            return Array.from(lines).map(l => l.textContent).join('\n');
        }
        
        // Textarea fallback
        const ta = document.querySelector('textarea');
        return ta?.value || '';
    }
    
    function setEditorContent(content) {
        try {
            const model = window.monaco?.editor?.getModels()?.[0];
            if (model) {
                model.setValue(content);
                return true;
            }
        } catch (e) {}
        
        const ta = document.querySelector('textarea');
        if (ta) {
            ta.value = content;
            return true;
        }
        return false;
    }

    // ════════════════════════════════════════════════════════════
    // 🎨 UI (floating panel)
    // ════════════════════════════════════════════════════════════
    
    function createPanel() {
        const div = document.createElement('div');
        div.id = 'token-golf-panel';
        div.innerHTML = `
            <div style="position: fixed; top: 80px; right: 20px; width: 300px; background: #1e1e1e; border: 1px solid #3e3e3e; border-radius: 8px; padding: 12px; font-family: system-ui; font-size: 13px; color: #e0e0e0; z-index: 10000;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <b>⛳ Token Golf</b>
                    <button id="tg-settings-btn" style="background: none; border: none; color: #888; cursor: pointer;">⚙️</button>
                </div>
                <div id="tg-settings" style="display: none; margin-bottom: 10px; padding: 8px; background: #2a2a2a; border-radius: 4px;">
                    <select id="tg-provider" style="width: 100%; padding: 5px; margin-bottom: 8px; background: #1e1e1e; border: 1px solid #3e3e3e; color: #e0e0e0;">
                        <option value="gemini">Gemini (Free)</option>
                        <option value="openai">OpenAI</option>
                    </select>
                    <input id="tg-api-key" type="password" placeholder="API Key" style="width: 100%; padding: 5px; background: #1e1e1e; border: 1px solid #3e3e3e; color: #e0e0e0; box-sizing: border-box;">
                    <div style="font-size: 10px; color: #666; margin-top: 5px;">🔒 Stored locally only</div>
                </div>
                <button id="tg-run" style="width: 100%; padding: 8px; background: linear-gradient(135deg, #667eea, #764ba2); border: none; border-radius: 4px; color: white; cursor: pointer; margin-bottom: 10px;">🚀 Run</button>
                <div id="tg-result" style="display: none; padding: 8px; background: #2a2a2a; border-radius: 4px; margin-bottom: 10px;">
                    <div>Tokens: <span id="tg-tokens">-</span></div>
                    <button id="tg-copy" style="margin-top: 8px; padding: 4px; background: #3e3e3e; border: none; border-radius: 4px; color: #e0e0e0; cursor: pointer; width: 100%;">📋 Copy</button>
                </div>
                <div id="tg-error" style="display: none; padding: 8px; background: #3e2a2a; border-radius: 4px; color: #ff6b6b; font-size: 12px;"></div>
            </div>
        `;
        return div;
    }
    
    // ════════════════════════════════════════════════════════════
    // 🚀 MAIN APP (brutally simple)
    // ════════════════════════════════════════════════════════════
    
    let currentResult = null;
    
    async function run() {
        const provider = document.getElementById('tg-provider').value;
        const apiKey = getAPIKey(provider);
        
        if (!apiKey) {
            document.getElementById('tg-error').style.display = 'block';
            document.getElementById('tg-error').textContent = '❌ Set API key in settings first';
            return;
        }
        
        const prompt = getEditorContent();
        if (!prompt || !prompt.trim()) {
            document.getElementById('tg-error').style.display = 'block';
            document.getElementById('tg-error').textContent = '❌ Editor is empty';
            return;
        }
        
        const btn = document.getElementById('tg-run');
        btn.disabled = true;
        btn.textContent = '⏳ Running...';
        document.getElementById('tg-error').style.display = 'none';
        
        try {
            let response;
            if (provider === 'gemini') {
                response = await callGemini(prompt, apiKey);
            } else {
                response = await callOpenAI(prompt, apiKey);
            }
            
            currentResult = response;
            
            document.getElementById('tg-result').style.display = 'block';
            document.getElementById('tg-tokens').textContent = response.tokens;
            
            setEditorContent(response.text);
            
        } catch (err) {
            document.getElementById('tg-error').style.display = 'block';
            document.getElementById('tg-error').textContent = `❌ ${err.message}`;
        } finally {
            btn.disabled = false;
            btn.textContent = '🚀 Run';
        }
    }
    
    function init() {
        const existing = document.getElementById('token-golf-panel');
        if (existing) existing.remove();
        
        const panel = createPanel();
        document.body.appendChild(panel);
        
        // Load saved settings
        const provider = GM_getValue('last_provider', 'gemini');
        const savedKey = getAPIKey(provider);
        
        document.getElementById('tg-provider').value = provider;
        if (savedKey) document.getElementById('tg-api-key').value = savedKey;
        
        // Event handlers
        document.getElementById('tg-settings-btn').onclick = () => {
            const s = document.getElementById('tg-settings');
            s.style.display = s.style.display === 'none' ? 'block' : 'none';
        };
        
        document.getElementById('tg-provider').onchange = (e) => {
            GM_setValue('last_provider', e.target.value);
            document.getElementById('tg-api-key').value = getAPIKey(e.target.value) || '';
        };
        
        document.getElementById('tg-api-key').onchange = (e) => {
            const prov = document.getElementById('tg-provider').value;
            setAPIKey(prov, e.target.value);
        };
        
        document.getElementById('tg-run').onclick = run;
        
        document.getElementById('tg-copy').onclick = () => {
            if (currentResult) {
                navigator.clipboard.writeText(currentResult.text);
                const btn = document.getElementById('tg-copy');
                const orig = btn.textContent;
                btn.textContent = '✓ Copied!';
                setTimeout(() => btn.textContent = orig, 1500);
            }
        };
        
        console.log('⛳ Token Golf ready');
    }
    
    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1000);
    }
    
})();
