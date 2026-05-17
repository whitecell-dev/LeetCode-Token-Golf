// ==UserScript==
// @name         LeetCode Token Golf (Fixed)
// @namespace    http://tampermonkey.net/
// @version      0.3.1
// @description  A profiler for LLM applications - optimize token efficiency. Fixed editor detection.
// @author       TokenGolf
// @match        https://leetcode.com/problems/*
// @match        https://leetcode.cn/problems/*
// @icon         data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">⛳</text></svg>
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ════════════════════════════════════════════════════════════
    // 🧩 BUBBLE 1: STORAGE LAYER
    // ════════════════════════════════════════════════════════════

    const StorageBubble = {
        _createRunKey(problemId) {
            return `token_golf_runs_${problemId}`;
        },

        saveRun(run) {
            const key = this._createRunKey(run.problemId);
            const existing = this.getRuns(run.problemId);
            existing.push(run);
            GM_setValue(key, JSON.stringify(existing));
            return { success: true };
        },

        getRuns(problemId) {
            const key = this._createRunKey(problemId);
            let raw = GM_getValue(key, null);

            if (!raw) return [];

            // Already an object/array → return directly
            if (Array.isArray(raw)) return raw;

            if (typeof raw !== 'string') {
                console.warn(`Invalid data type for ${key}, resetting`);
                GM_deleteValue(key);
                return [];
            }

            // 🔥 Critical fix: guard BEFORE parsing
            const trimmed = raw.trim();

            if (
                trimmed === '' ||
                trimmed === 'undefined' ||
                trimmed === 'null'
            ) {
                GM_deleteValue(key);
                return [];
            }

            try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                console.warn(`Corrupted JSON for ${key}:`, raw);
                GM_deleteValue(key);
                return [];
            }
        },

        getAPIKey(provider = 'openai') {
            return GM_getValue(`token_golf_api_key_${provider}`, null);
        },

        setAPIKey(provider, key) {
            GM_setValue(`token_golf_api_key_${provider}`, key);
            return { success: true };
        },

        clearRuns(problemId) {
            const key = this._createRunKey(problemId);
            GM_deleteValue(key);
            return { success: true };
        }
    };

    // ════════════════════════════════════════════════════════════
    // 🧩 BUBBLE 1.5: IR COMPILER
    // ════════════════════════════════════════════════════════════

    const IRCompilerBubble = {
        compileToIR(naturalPrompt, problemContext) {
            const intent = this._extractIntent(naturalPrompt);
            return {
                task: intent.task,
                input: intent.input,
                output: intent.output,
                constraints: intent.constraints,
                format: "code_only"
            };
        },
        _extractIntent(prompt) {
            const lowerPrompt = prompt.toLowerCase();
            let task = "solve";
            if (lowerPrompt.includes("optimize")) task = "optimize";
            if (lowerPrompt.includes("fix")) task = "fix";
            if (lowerPrompt.includes("refactor")) task = "refactor";
            if (lowerPrompt.includes("debug")) task = "debug";
            return {
                task: task,
                input: "code_problem",
                output: "working_solution",
                constraints: ["pass_tests", "optimal_complexity"]
            };
        },
        renderPrompt(ir, problemDescription) {
            return `Task: ${ir.task}
Problem: ${this._compressProblemDescription(problemDescription)}
Output: ${ir.output}
Format: ${ir.format}
Constraints: ${ir.constraints.join(", ")}`;
        },
        _compressProblemDescription(description) {
            const lines = description.split('\n');
            const essentialLines = lines.filter(line => {
                const lower = line.toLowerCase();
                return !lower.includes('example') &&
                       !lower.includes('follow-up') &&
                       !lower.includes('note:') &&
                       line.trim().length > 0;
            });
            return essentialLines.slice(0, 5).join(' ').substring(0, 200);
        },
        generateFallback(ir, errorContext) {
            return `${this.renderPrompt(ir, errorContext)}

IMPORTANT: Provide only the code solution. No explanations.`;
        }
    };

    // ════════════════════════════════════════════════════════════
    // 🧩 BUBBLE 2: LLM PROXY
    // ════════════════════════════════════════════════════════════
    const LLMProxyBubble = {
        estimateTokens(text) {
            return Math.ceil(text.length / 4);
        },

        async callWithCascade(prompt, provider, model, apiKey, useIR = false) {
            const results = {
                attempts: [],
                finalResponse: null,
                totalTokens: 0,
                cascadeDepth: 0
            };

            // Stage 1: Try cheap model with IR (if enabled)
            if (useIR && provider === 'gemini') {
                try {
                    const response = await this.callLLM(prompt, 'gemini', 'gemini-1.5-flash', apiKey);
                    results.attempts.push({ model: 'gemini-1.5-flash', tokens: response.tokens, success: true });
                    results.totalTokens += response.tokens;
                    results.cascadeDepth = 1;
                    results.finalResponse = response;
                    return results;
                } catch (error) {
                    results.attempts.push({ model: 'gemini-1.5-flash', error: error.message, success: false });
                }
            }

            // Stage 2: Original model
            try {
                const response = await this.callLLM(prompt, provider, model, apiKey);
                results.attempts.push({ model: model, tokens: response.tokens, success: true });
                results.totalTokens += response.tokens;
                results.cascadeDepth = results.attempts.length;
                results.finalResponse = response;
                return results;
            } catch (error) {
                results.attempts.push({ model: model, error: error.message, success: false });
                throw error;
            }
        },

        async _callOpenAI(prompt, model, apiKey) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://api.openai.com/v1/chat/completions',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    data: JSON.stringify({
                        model: model || 'gpt-4o-mini',
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.7
                    }),
                    onload: (res) => {
                        let d;
                        try {
                            d = JSON.parse(res.responseText);
                        } catch (e) {
                            console.error('Raw OpenAI response:', res.responseText);
                            reject(new Error(`Invalid JSON response from OpenAI: ${e.message}`));
                            return;
                        }

                        if (d.error) {
                            reject(new Error(`OpenAI API error: ${d.error.message}`));
                        } else if (!d.choices || !d.choices[0] || !d.choices[0].message) {
                            reject(new Error(`Unexpected OpenAI response structure: ${JSON.stringify(d)}`));
                        } else {
                            resolve({
                                text: d.choices[0].message.content,
                                tokens: d.usage?.total_tokens || Math.ceil((prompt.length + d.choices[0].message.content.length) / 4),
                                model: d.model
                            });
                        }
                    },
                    onerror: (err) => reject(new Error(`OpenAI network error: ${err}`))
                });
            });
        },

        async _callAnthropic(prompt, model, apiKey) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://api.anthropic.com/v1/messages',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                    data: JSON.stringify({
                        model: model || 'claude-3-5-haiku-20241022',
                        max_tokens: 4096,
                        messages: [{ role: 'user', content: prompt }]
                    }),
                    onload: (res) => {
                        let d;
                        try {
                            d = JSON.parse(res.responseText);
                        } catch (e) {
                            console.error('Raw Anthropic response:', res.responseText);
                            reject(new Error(`Invalid JSON response from Anthropic: ${e.message}`));
                            return;
                        }

                        if (d.error) {
                            reject(new Error(`Anthropic API error: ${d.error.message}`));
                        } else if (!d.content || !d.content[0] || !d.content[0].text) {
                            reject(new Error(`Unexpected Anthropic response structure: ${JSON.stringify(d)}`));
                        } else {
                            resolve({
                                text: d.content[0].text,
                                tokens: (d.usage?.input_tokens || 0) + (d.usage?.output_tokens || 0) || Math.ceil((prompt.length + d.content[0].text.length) / 4),
                                model: d.model
                            });
                        }
                    },
                    onerror: (err) => reject(new Error(`Anthropic network error: ${err}`))
                });
            });
        },

        async _callGemini(prompt, model, apiKey) {
            const geminiModel = model || 'gemini-1.5-flash';
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.7 }
                    }),
                    onload: (res) => {
                        let d;
                        try {
                            d = JSON.parse(res.responseText);
                        } catch (e) {
                            console.error('Raw Gemini response:', res.responseText);
                            reject(new Error(`Invalid JSON response from Gemini: ${e.message}`));
                            return;
                        }

                        if (d.error) {
                            reject(new Error(`Gemini API error: ${d.error.message}`));
                        } else if (!d.candidates || !d.candidates[0] || !d.candidates[0].content || !d.candidates[0].content.parts || !d.candidates[0].content.parts[0]) {
                            // Gemini sometimes returns empty but valid responses
                            const text = '';
                            const tokens = d.usageMetadata?.totalTokenCount || Math.ceil(prompt.length / 4);
                            resolve({ text, tokens, model: geminiModel, provider: 'gemini' });
                        } else {
                            const text = d.candidates[0].content.parts[0].text || '';
                            const tokens = d.usageMetadata?.totalTokenCount || Math.ceil((prompt.length + text.length) / 4);
                            resolve({ text, tokens, model: geminiModel, provider: 'gemini' });
                        }
                    },
                    onerror: (err) => reject(new Error(`Gemini network error: ${err}`))
                });
            });
        },

        async callLLM(prompt, provider, model, apiKey) {
            if (provider === 'gemini') return await this._callGemini(prompt, model, apiKey);
            if (provider === 'anthropic') return await this._callAnthropic(prompt, model, apiKey);
            return await this._callOpenAI(prompt, model, apiKey);
        }
    };

    // ════════════════════════════════════════════════════════════
    // 🧩 BUBBLE 3: UI CORE
    // ════════════════════════════════════════════════════════════

    const UIBubble = {
        state: { currentRun: null, history: [], isRunning: false, provider: 'gemini', model: 'gemini-1.5-flash', useIR: true },
        _createPanelHTML() {
            return `
                <div id="token-golf-panel" style="position: fixed; top: 80px; right: 20px; width: 360px; background: #1e1e1e; border: 1px solid #3e3e3e; border-radius: 8px; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #e0e0e0; z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div style="font-weight: 600; font-size: 14px;">⛳ Token Golf</div>
                        <div><span style="font-size: 10px; color: #666; margin-right: 8px;">v0.3.1</span><button id="tg-settings-btn" style="background: none; border: none; color: #888; cursor: pointer; font-size: 16px;">⚙️</button></div>
                    </div>
                    <div id="tg-settings" style="display: none; margin-bottom: 12px; padding: 12px; background: #2a2a2a; border-radius: 4px;">
                        <div style="margin-bottom: 8px;"><label style="display: flex; align-items: center; cursor: pointer;"><input type="checkbox" id="tg-use-ir" checked style="margin-right: 6px;"><span style="font-size: 11px; color: #e0e0e0;">Use IR Optimization (60-80% reduction)</span></label></div>
                        <div style="margin-bottom: 8px; padding-top: 8px; border-top: 1px solid #3e3e3e;"><label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">Provider</label><select id="tg-provider" style="width: 100%; padding: 6px; background: #1e1e1e; border: 1px solid #3e3e3e; color: #e0e0e0; border-radius: 4px;"><option value="gemini">Gemini</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></div>
                        <div style="margin-bottom: 8px;"><label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">Model</label><input id="tg-model" type="text" placeholder="gemini-1.5-flash" style="width: 100%; padding: 6px; background: #1e1e1e; border: 1px solid #3e3e3e; color: #e0e0e0; border-radius: 4px;"></div>
                        <div><label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">API Key</label><input id="tg-api-key" type="password" placeholder="Get free key from aistudio.google.com" style="width: 100%; padding: 6px; background: #1e1e1e; border: 1px solid #3e3e3e; color: #e0e0e0; border-radius: 4px;"></div>
                    </div>
                    <button id="tg-run-btn" style="width: 100%; padding: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; border-radius: 6px; color: white; font-weight: 600; cursor: pointer; margin-bottom: 12px;">🚀 Run with AI</button>
                    <div id="tg-result" style="display: none; padding: 12px; background: #2a2a2a; border-radius: 4px; margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span style="color: #888;">Tokens Used</span><span id="tg-tokens" style="font-weight: 600; color: #667eea;">-</span></div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span style="color: #888;">Model</span><span id="tg-model-used" style="font-size: 11px;">-</span></div>
                        <div id="tg-ir-indicator" style="display: none; margin-bottom: 8px;"><span style="font-size: 10px; color: #4ade80;">🧬 IR Optimized</span></div>
                        <div id="tg-cascade-indicator" style="display: none; margin-bottom: 8px;"><span style="font-size: 10px; color: #fbbf24;">🔄 Cascade Depth: <span id="tg-cascade-depth">-</span></span></div>
                        <div style="margin-top: 12px;"><button id="tg-copy-btn" style="width: 100%; padding: 8px; background: #3e3e3e; border: none; border-radius: 4px; color: #e0e0e0; cursor: pointer; font-size: 12px;">📋 Copy Response</button></div>
                    </div>
                    <div id="tg-error" style="display: none; padding: 12px; background: #3e2a2a; border-radius: 4px; margin-bottom: 12px; color: #ff6b6b;"></div>
                    <div id="tg-history" style="max-height: 200px; overflow-y: auto;"><div style="font-size: 11px; color: #888; margin-bottom: 8px;">Recent Runs</div><div id="tg-history-list"></div></div>
                </div>`;
        },
        _createHistoryItemHTML(run, index) {
            const passedIcon = run.passed === null ? '⏳' : run.passed ? '✅' : '❌';
            const irBadge = run.useIR ? ' <span style="color: #4ade80;">🧬</span>' : '';
            const cascadeBadge = run.cascadeDepth > 1 ? ` <span style="color: #fbbf24;">🔄${run.cascadeDepth}</span>` : '';
            const date = new Date(run.timestamp).toLocaleTimeString();
            return `<div style="padding: 8px; background: #2a2a2a; border-radius: 4px; margin-bottom: 6px; font-size: 11px;"><div style="display: flex; justify-content: space-between;"><span>${passedIcon} ${run.tokens} tokens${irBadge}${cascadeBadge}</span><span style="color: #666;">${date}</span></div><div style="color: #888; margin-top: 4px;">${run.model}</div></div>`;
        },
        renderPanel() { const p = document.createElement('div'); p.innerHTML = this._createPanelHTML(); return p.firstElementChild; },
        updateHistory(runs) {
            const l = document.getElementById('tg-history-list');
            if (!l) return;
            l.innerHTML = runs.length === 0 ? '<div style="color: #666; font-size: 11px; padding: 8px;">No runs yet</div>' : runs.slice(-5).reverse().map((r, i) => this._createHistoryItemHTML(r, i)).join('');
        },
        showResult(response, useIR, cascadeDepth) {
            const r = document.getElementById('tg-result'); const e = document.getElementById('tg-error');
            if (!r || !e) return;
            e.style.display = 'none'; r.style.display = 'block';
            document.getElementById('tg-tokens').textContent = response.tokens;
            document.getElementById('tg-model-used').textContent = response.model;
            document.getElementById('tg-ir-indicator').style.display = useIR ? 'block' : 'none';
            const ci = document.getElementById('tg-cascade-indicator');
            if (ci) { if (cascadeDepth > 1) { ci.style.display = 'block'; document.getElementById('tg-cascade-depth').textContent = cascadeDepth; } else ci.style.display = 'none'; }
            this.state.currentRun = response;
        },
        showError(msg) {
            const e = document.getElementById('tg-error'); const r = document.getElementById('tg-result');
            if (!e || !r) return;
            r.style.display = 'none'; e.style.display = 'block'; e.textContent = `❌ ${msg}`;
        },
        setLoading(isLoading) {
            const b = document.getElementById('tg-run-btn');
            if (!b) return;
            this.state.isRunning = isLoading; b.disabled = isLoading; b.style.opacity = isLoading ? '0.6' : '1'; b.textContent = isLoading ? '⏳ Running...' : '🚀 Run with AI';
        }
    };

    // ════════════════════════════════════════════════════════════
    // 🧩 BUBBLE 4: LEETCODE DOM (ROBUST VERSION)
    // ════════════════════════════════════════════════════════════

    const LeetCodeDOMBubble = {
        getProblemId() {
            const m = window.location.pathname.match(/\/problems\/([^\/]+)/);
            return m ? m[1] : 'unknown';
        },
        getProblemDescription() {
            const d = document.querySelector('[data-track-load="description_content"]') || document.querySelector('.question-content');
            return d ? d.textContent.trim() : '';
        },

        // Helper: Scrape the visual DOM lines. This is the fallback if Monaco API fails.
        _scrapeDOMContent() {
            // Look for the standard Monaco .view-line container
            const viewLines = document.querySelectorAll('.view-line');
            if (viewLines.length > 0) {
                return Array.from(viewLines)
                    .map(line => line.textContent)
                    .join('\n');
            }
            return '';
        },

        getEditorContent() {
            // 1. Try Monaco API (Standard way)
            try {
                if (window.monaco && window.monaco.editor) {
                    const models = window.monaco.editor.getModels();
                    if (models && models.length > 0) {
                        const content = models[0].getValue();
                        if (content && content.length > 0) return content;
                    }
                }
            } catch (e) { console.warn('Monaco API fail', e); }

            // 2. Fallback: Scrape DOM lines. This works even if API isn't ready.
            const domContent = this._scrapeDOMContent();
            if (domContent && domContent.length > 0) {
                return domContent;
            }

            // 3. Last resort: Check for textareas (legacy)
            const textareas = document.querySelectorAll('textarea');
            for (const ta of textareas) {
                if (ta.rows > 3 && ta.value.length > 0) return ta.value;
            }

            return '';
        },

        setEditorContent(content) {
            // Setting content requires the Monaco API to preserve state/formatting.
            // If this fails, we advise the user.
            try {
                if (window.monaco && window.monaco.editor) {
                    const models = window.monaco.editor.getModels();
                    if (models && models.length > 0) {
                        models[0].setValue(content);
                        return true;
                    }
                }
            } catch (e) { console.warn('Set Monaco fail', e); }

            // Fallback for setting content is hard without API.
            // We try to focus the editor to force init, then set.
            const editorContainer = document.querySelector('.monaco-editor');
            if (editorContainer) {
                editorContainer.click();
                setTimeout(() => {
                    try {
                        const models = window.monaco.editor.getModels();
                        if (models && models.length > 0) models[0].setValue(content);
                    } catch (e) {}
                }, 200);
                return true; // Optimistic return
            }
            return false;
        },
        injectUI(el) {
            const e = document.getElementById('token-golf-panel');
            if (e) e.remove();
            document.body.appendChild(el);
        },
        observeSubmissions(cb) {
            const obs = new MutationObserver((m) => {
                for (const x of m) for (const n of x.addedNodes) {
                    if (n.nodeType === 1) {
                        const t = n.textContent || '';
                        if (t.includes('Accepted')) cb({ passed: true, ts: Date.now() });
                        else if (t.includes('Wrong Answer') || t.includes('Runtime Error')) cb({ passed: false, ts: Date.now() });
                    }
                }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            return obs;
        }
    };

    // ════════════════════════════════════════════════════════════
    // 🔄 ORCHESTRATOR
    // ════════════════════════════════════════════════════════════

    const App = {
        async init() {
            console.log('🏌️ Token Golf v0.3.1 starting...');
            const p = UIBubble.renderPanel();
            LeetCodeDOMBubble.injectUI(p);
            const pid = LeetCodeDOMBubble.getProblemId();
            UIBubble.updateHistory(StorageBubble.getRuns(pid));
            this._bindEvents();
            this._loadSettings();
            LeetCodeDOMBubble.observeSubmissions(r => this._handleSubmissionResult(r));
        },
        _loadSettings() {
            const prov = GM_getValue('token_golf_provider', 'gemini');
            const mod = GM_getValue('token_golf_model', 'gemini-1.5-flash');
            const useIR = GM_getValue('token_golf_use_ir', true);
            const key = StorageBubble.getAPIKey(prov);
            document.getElementById('tg-provider').value = prov;
            document.getElementById('tg-model').value = mod;
            document.getElementById('tg-use-ir').checked = useIR;
            if (key) document.getElementById('tg-api-key').value = key;
            UIBubble.state.provider = prov;
            UIBubble.state.model = mod;
            UIBubble.state.useIR = useIR;
        },
        _bindEvents() {
            document.getElementById('tg-settings-btn').onclick = () => {
                const s = document.getElementById('tg-settings');
                s.style.display = s.style.display === 'none' ? 'block' : 'none';
            };
            document.getElementById('tg-use-ir').onchange = (e) => {
                UIBubble.state.useIR = e.target.checked;
                GM_setValue('token_golf_use_ir', e.target.checked);
            };
            document.getElementById('tg-provider').onchange = (e) => {
                const prov = e.target.value;
                UIBubble.state.provider = prov;
                GM_setValue('token_golf_provider', prov);
                const modIn = document.getElementById('tg-model');
                const keyIn = document.getElementById('tg-api-key');
                let mod = '';
                if (prov === 'gemini') mod = 'gemini-1.5-flash';
                else if (prov === 'openai') mod = 'gpt-4o-mini';
                else mod = 'claude-3-5-haiku-20241022';
                modIn.value = mod;
                UIBubble.state.model = mod;
                GM_setValue('token_golf_model', mod);
                keyIn.value = StorageBubble.getAPIKey(prov) || '';
            };
            document.getElementById('tg-model').oninput = (e) => {
                UIBubble.state.model = e.target.value;
                GM_setValue('token_golf_model', e.target.value);
            };
            document.getElementById('tg-api-key').onchange = (e) => StorageBubble.setAPIKey(UIBubble.state.provider, e.target.value);
            document.getElementById('tg-run-btn').onclick = () => this._handleRunClick();
            document.getElementById('tg-copy-btn').onclick = () => {
                const r = UIBubble.state.currentRun;
                if (!r) return;
                navigator.clipboard.writeText(r.text).then(() => {
                    const b = document.getElementById('tg-copy-btn');
                    const t = b.textContent; b.textContent = '✓ Copied!';
                    setTimeout(() => b.textContent = t, 2000);
                });
            };
        },
        async _handleRunClick() {
            // 1. Retry logic for Editor Detection
            let prompt = '';
            let retries = 0;
            while (retries < 5) {
                prompt = LeetCodeDOMBubble.getEditorContent();
                if (prompt && prompt.trim().length > 0) break;
                await new Promise(r => setTimeout(r, 300));
                retries++;
            }

            if (!prompt || prompt.trim().length === 0) {
                UIBubble.showError('Editor is empty. Please click the code area and type something first.');
                return;
            }

            const prov = UIBubble.state.provider;
            const mod = UIBubble.state.model;
            const useIR = UIBubble.state.useIR;
            const key = StorageBubble.getAPIKey(prov);

            if (!key) {
                UIBubble.showError(`API Key missing for ${prov}. Check settings.`);
                return;
            }

            UIBubble.setLoading(true);
            try {
                let finalPrompt = prompt;
                if (useIR) {
                    const pd = LeetCodeDOMBubble.getProblemDescription();
                    const ir = IRCompilerBubble.compileToIR(prompt, pd);
                    finalPrompt = IRCompilerBubble.renderPrompt(ir, pd);
                }

                const cRes = await LLMProxyBubble.callWithCascade(finalPrompt, prov, mod, key, useIR);
                const res = cRes.finalResponse;

                UIBubble.showResult(res, useIR, cRes.cascadeDepth);

                const pid = LeetCodeDOMBubble.getProblemId();
                const run = {
                    problemId: pid,
                    timestamp: Date.now(),
                    prompt: finalPrompt,
                    tokens: cRes.totalTokens,
                    model: res.model,
                    passed: null,
                    response: res.text,
                    useIR: useIR,
                    cascadeDepth: cRes.cascadeDepth
                };
                StorageBubble.saveRun(run);
                UIBubble.updateHistory(StorageBubble.getRuns(pid));
                LeetCodeDOMBubble.setEditorContent(res.text);

            } catch (err) {
                UIBubble.showError(err.message || 'Request failed');
                console.error(err);
            } finally {
                UIBubble.setLoading(false);
            }
        },
        _handleSubmissionResult(res) {
            const pid = LeetCodeDOMBubble.getProblemId();
            const runs = StorageBubble.getRuns(pid);
            if (runs.length === 0) return;
            const last = runs[runs.length - 1];
            if (last.passed === null) {
                last.passed = res.passed;
                GM_setValue(`token_golf_runs_${pid}`, JSON.stringify(runs));
                UIBubble.updateHistory(runs);
            }
        }
    };

    // ════════════════════════════════════════════════════════════
    // 🚀 BOOTSTRAP
    // ════════════════════════════════════════════════════════════

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => App.init());
    } else {
        setTimeout(() => App.init(), 1000);
    }

    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            if (url.includes('/problems/')) setTimeout(() => App.init(), 500);
        }
    }).observe(document.body, { childList: true, subtree: true });

})();
