// ==UserScript==
// @name         LeetCode Token Golf
// @namespace    http://tampermonkey.net/
// @version      0.1.1
// @description  Track token efficiency on LeetCode - your API key never leaves your browser
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
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ════════════════════════════════════════════════════════════
    // 🧩 BUBBLE 1: STORAGE LAYER (Pure Core - No Side Effects)
    // ════════════════════════════════════════════════════════════
    
    const StorageBubble = {
        // Pure functions for data transformation
        _createRunKey(problemId) {
            return `token_golf_runs_${problemId}`;
        },

        _serializeRun(run) {
            return JSON.stringify({
                problemId: run.problemId,
                timestamp: run.timestamp,
                prompt: run.prompt,
                tokens: run.tokens,
                model: run.model,
                passed: run.passed,
                response: run.response
            });
        },

        _deserializeRuns(json) {
            try {
                return JSON.parse(json || '[]');
            } catch {
                return [];
            }
        },

        // Public interface (message-passing style)
        saveRun(run) {
            const key = this._createRunKey(run.problemId);
            const existing = this._deserializeRuns(GM_getValue(key));
            existing.push(run);
            GM_setValue(key, JSON.stringify(existing));
            return { success: true };
        },

        getRuns(problemId) {
            const key = this._createRunKey(problemId);
            return this._deserializeRuns(GM_getValue(key));
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
    // 🧩 BUBBLE 2: LLM PROXY (I/O Shell - Side Effects Isolated)
    // ════════════════════════════════════════════════════════════
    
    const LLMProxyBubble = {
        // Token estimation (pure function)
        estimateTokens(text) {
            // Rough estimation: ~4 chars per token
            return Math.ceil(text.length / 4);
        },

        // OpenAI API call
        async _callOpenAI(prompt, model, apiKey) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://api.openai.com/v1/chat/completions',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    data: JSON.stringify({
                        model: model || 'gpt-4o-mini',
                        messages: [
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.7
                    }),
                    onload: (response) => {
                        try {
                            const data = JSON.parse(response.responseText);
                            if (data.error) {
                                reject(new Error(data.error.message));
                                return;
                            }
                            resolve({
                                text: data.choices[0].message.content,
                                tokens: data.usage.total_tokens,
                                model: data.model
                            });
                        } catch (e) {
                            reject(e);
                        }
                    },
                    onerror: (err) => reject(err)
                });
            });
        },

        // Anthropic API call
        async _callAnthropic(prompt, model, apiKey) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://api.anthropic.com/v1/messages',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01'
                    },
                    data: JSON.stringify({
                        model: model || 'claude-3-5-haiku-20241022',
                        max_tokens: 4096,
                        messages: [
                            { role: 'user', content: prompt }
                        ]
                    }),
                    onload: (response) => {
                        try {
                            const data = JSON.parse(response.responseText);
                            if (data.error) {
                                reject(new Error(data.error.message));
                                return;
                            }
                            const tokens = data.usage.input_tokens + data.usage.output_tokens;
                            resolve({
                                text: data.content[0].text,
                                tokens: tokens,
                                model: data.model
                            });
                        } catch (e) {
                            reject(e);
                        }
                    },
                    onerror: (err) => reject(err)
                });
            });
        },

        // Public interface
        async callLLM(prompt, provider, model, apiKey) {
            if (!apiKey) {
                throw new Error('API key not set');
            }

            if (provider === 'anthropic') {
                return await this._callAnthropic(prompt, model, apiKey);
            } else {
                return await this._callOpenAI(prompt, model, apiKey);
            }
        }
    };

    // ════════════════════════════════════════════════════════════
    // 🧩 BUBBLE 3: UI CORE (Transform Layer - Pure Rendering)
    // ════════════════════════════════════════════════════════════
    
    const UIBubble = {
        state: {
            currentRun: null,
            history: [],
            isRunning: false,
            provider: 'openai',
            model: 'gpt-4o-mini'
        },

        // Pure template functions
        _createPanelHTML() {
            return `
                <div id="token-golf-panel" style="
                    position: fixed;
                    top: 80px;
                    right: 20px;
                    width: 340px;
                    background: #1e1e1e;
                    border: 1px solid #3e3e3e;
                    border-radius: 8px;
                    padding: 16px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                    font-size: 13px;
                    color: #e0e0e0;
                    z-index: 10000;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div style="font-weight: 600; font-size: 14px;">⛳ Token Golf</div>
                        <button id="tg-settings-btn" style="
                            background: none;
                            border: none;
                            color: #888;
                            cursor: pointer;
                            font-size: 16px;
                        ">⚙️</button>
                    </div>

                    <div id="tg-settings" style="display: none; margin-bottom: 12px; padding: 12px; background: #2a2a2a; border-radius: 4px;">
                        <div style="margin-bottom: 8px;">
                            <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">Provider</label>
                            <select id="tg-provider" style="width: 100%; padding: 6px; background: #1e1e1e; border: 1px solid #3e3e3e; color: #e0e0e0; border-radius: 4px;">
                                <option value="openai">OpenAI</option>
                                <option value="anthropic">Anthropic</option>
                            </select>
                        </div>
                        <div style="margin-bottom: 8px;">
                            <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">Model</label>
                            <input id="tg-model" type="text" placeholder="gpt-4o-mini" style="width: 100%; padding: 6px; background: #1e1e1e; border: 1px solid #3e3e3e; color: #e0e0e0; border-radius: 4px;">
                        </div>
                        <div>
                            <label style="display: block; margin-bottom: 4px; font-size: 11px; color: #888;">API Key</label>
                            <input id="tg-api-key" type="password" placeholder="sk-..." style="width: 100%; padding: 6px; background: #1e1e1e; border: 1px solid #3e3e3e; color: #e0e0e0; border-radius: 4px;">
                        </div>
                        <div style="margin-top: 8px; font-size: 10px; color: #666;">
                            🔒 Stored locally. Never sent to our servers.
                        </div>
                    </div>

                    <button id="tg-run-btn" style="
                        width: 100%;
                        padding: 10px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        border: none;
                        border-radius: 6px;
                        color: white;
                        font-weight: 600;
                        cursor: pointer;
                        margin-bottom: 12px;
                        transition: opacity 0.2s;
                    ">
                        🚀 Run with AI
                    </button>

                    <div id="tg-result" style="display: none; padding: 12px; background: #2a2a2a; border-radius: 4px; margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span style="color: #888;">Tokens Used</span>
                            <span id="tg-tokens" style="font-weight: 600; color: #667eea;">-</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span style="color: #888;">Model</span>
                            <span id="tg-model-used" style="font-size: 11px;">-</span>
                        </div>
                        <div style="margin-top: 12px;">
                            <button id="tg-copy-btn" style="
                                width: 100%;
                                padding: 8px;
                                background: #3e3e3e;
                                border: none;
                                border-radius: 4px;
                                color: #e0e0e0;
                                cursor: pointer;
                                font-size: 12px;
                            ">📋 Copy Response</button>
                        </div>
                    </div>

                    <div id="tg-error" style="display: none; padding: 12px; background: #3e2a2a; border-radius: 4px; margin-bottom: 12px; color: #ff6b6b;">
                    </div>

                    <div id="tg-history" style="max-height: 200px; overflow-y: auto;">
                        <div style="font-size: 11px; color: #888; margin-bottom: 8px;">Recent Runs</div>
                        <div id="tg-history-list"></div>
                    </div>
                </div>
            `;
        },

        _createHistoryItemHTML(run, index) {
            const passedIcon = run.passed === null ? '⏳' : run.passed ? '✅' : '❌';
            const date = new Date(run.timestamp).toLocaleTimeString();
            return `
                <div style="padding: 8px; background: #2a2a2a; border-radius: 4px; margin-bottom: 6px; font-size: 11px;">
                    <div style="display: flex; justify-content: space-between;">
                        <span>${passedIcon} ${run.tokens} tokens</span>
                        <span style="color: #666;">${date}</span>
                    </div>
                    <div style="color: #888; margin-top: 4px;">${run.model}</div>
                </div>
            `;
        },

        // Public interface
        renderPanel() {
            const panel = document.createElement('div');
            panel.innerHTML = this._createPanelHTML();
            return panel.firstElementChild;
        },

        updateHistory(runs) {
            const listEl = document.getElementById('tg-history-list');
            if (!listEl) return;

            if (runs.length === 0) {
                listEl.innerHTML = '<div style="color: #666; font-size: 11px; padding: 8px;">No runs yet</div>';
                return;
            }

            listEl.innerHTML = runs.slice(-5).reverse()
                .map((run, i) => this._createHistoryItemHTML(run, i))
                .join('');
        },

        showResult(response) {
            const resultEl = document.getElementById('tg-result');
            const errorEl = document.getElementById('tg-error');
            
            if (!resultEl || !errorEl) return;

            errorEl.style.display = 'none';
            resultEl.style.display = 'block';
            
            document.getElementById('tg-tokens').textContent = response.tokens;
            document.getElementById('tg-model-used').textContent = response.model;
            
            this.state.currentRun = response;
        },

        showError(message) {
            const errorEl = document.getElementById('tg-error');
            const resultEl = document.getElementById('tg-result');
            
            if (!errorEl || !resultEl) return;

            resultEl.style.display = 'none';
            errorEl.style.display = 'block';
            errorEl.textContent = `❌ ${message}`;
        },

        setLoading(isLoading) {
            const btn = document.getElementById('tg-run-btn');
            if (!btn) return;

            this.state.isRunning = isLoading;
            btn.disabled = isLoading;
            btn.style.opacity = isLoading ? '0.6' : '1';
            btn.textContent = isLoading ? '⏳ Running...' : '🚀 Run with AI';
        }
    };

    // ════════════════════════════════════════════════════════════
    // 🧩 BUBBLE 4: LEETCODE DOM (I/O Shell - Page Integration)
    // ════════════════════════════════════════════════════════════
    
    const LeetCodeDOMBubble = {
        // Extract problem ID from URL
        getProblemId() {
            const match = window.location.pathname.match(/\/problems\/([^\/]+)/);
            return match ? match[1] : 'unknown';
        },

        // Get editor content
        getEditorContent() {
            // Try Monaco editor first (new LeetCode UI)
            const monacoEditor = document.querySelector('.monaco-editor');
            if (monacoEditor) {
                try {
                    const model = window.monaco?.editor?.getModels()?.[0];
                    if (model) return model.getValue();
                } catch (e) {
                    console.error('Monaco editor access failed:', e);
                }
            }

            // Fallback: try CodeMirror
            const codeMirror = document.querySelector('.CodeMirror');
            if (codeMirror && codeMirror.CodeMirror) {
                return codeMirror.CodeMirror.getValue();
            }

            // Last resort: textarea
            const textarea = document.querySelector('textarea');
            return textarea ? textarea.value : '';
        },

        // Set editor content
        setEditorContent(content) {
            // Try Monaco editor
            const monacoEditor = document.querySelector('.monaco-editor');
            if (monacoEditor) {
                try {
                    const model = window.monaco?.editor?.getModels()?.[0];
                    if (model) {
                        model.setValue(content);
                        return true;
                    }
                } catch (e) {
                    console.error('Monaco editor write failed:', e);
                }
            }

            // Fallback: CodeMirror
            const codeMirror = document.querySelector('.CodeMirror');
            if (codeMirror && codeMirror.CodeMirror) {
                codeMirror.CodeMirror.setValue(content);
                return true;
            }

            // Last resort: textarea
            const textarea = document.querySelector('textarea');
            if (textarea) {
                textarea.value = content;
                return true;
            }

            return false;
        },

        // Inject UI into page
        injectUI(panelElement) {
            // Remove existing panel if present
            const existing = document.getElementById('token-golf-panel');
            if (existing) existing.remove();

            document.body.appendChild(panelElement);
        },

        // Detect submission result (watches DOM for changes)
        observeSubmissions(callback) {
            // Watch for submission result modal/panel
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            // Look for accepted/wrong answer indicators
                            const text = node.textContent || '';
                            if (text.includes('Accepted')) {
                                callback({ passed: true, timestamp: Date.now() });
                            } else if (text.includes('Wrong Answer') || text.includes('Runtime Error')) {
                                callback({ passed: false, timestamp: Date.now() });
                            }
                        }
                    }
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            return observer;
        }
    };

    // ════════════════════════════════════════════════════════════
    // 🔄 MESSAGE PASSING ORCHESTRATOR (Integration Layer)
    // ════════════════════════════════════════════════════════════
    
    const App = {
        async init() {
            console.log('🏌️ Token Golf initializing...');

            // Render UI
            const panel = UIBubble.renderPanel();
            LeetCodeDOMBubble.injectUI(panel);

            // Load state
            const problemId = LeetCodeDOMBubble.getProblemId();
            const history = StorageBubble.getRuns(problemId);
            UIBubble.updateHistory(history);

            // Bind events
            this._bindEvents();

            // Load saved settings
            this._loadSettings();

            // Observe submissions
            LeetCodeDOMBubble.observeSubmissions((result) => {
                this._handleSubmissionResult(result);
            });

            console.log('✅ Token Golf ready');
        },

        _loadSettings() {
            const provider = GM_getValue('token_golf_provider', 'openai');
            const model = GM_getValue('token_golf_model', 'gpt-4o-mini');
            const apiKey = StorageBubble.getAPIKey(provider);

            document.getElementById('tg-provider').value = provider;
            document.getElementById('tg-model').value = model;
            if (apiKey) {
                document.getElementById('tg-api-key').value = apiKey;
            }

            UIBubble.state.provider = provider;
            UIBubble.state.model = model;
        },

        _bindEvents() {
            // Settings toggle
            document.getElementById('tg-settings-btn').onclick = () => {
                const settings = document.getElementById('tg-settings');
                settings.style.display = settings.style.display === 'none' ? 'block' : 'none';
            };

            // CRITICAL: All input handlers MUST update UIBubble.state
            // State is the single source of truth, not the DOM

            // Provider change
            document.getElementById('tg-provider').onchange = (e) => {
                const provider = e.target.value;
                UIBubble.state.provider = provider;
                GM_setValue('token_golf_provider', provider);
                
                // Load saved API key for this provider
                const apiKey = StorageBubble.getAPIKey(provider);
                if (apiKey) {
                    document.getElementById('tg-api-key').value = apiKey;
                } else {
                    document.getElementById('tg-api-key').value = '';
                }
            };

            // Model change
            document.getElementById('tg-model').oninput = (e) => {
                UIBubble.state.model = e.target.value;
                GM_setValue('token_golf_model', e.target.value);
            };

            // API key change
            document.getElementById('tg-api-key').onchange = (e) => {
                const provider = UIBubble.state.provider;
                StorageBubble.setAPIKey(provider, e.target.value);
            };

            // Run button
            document.getElementById('tg-run-btn').onclick = () => {
                this._handleRunClick();
            };

            // Copy button
            document.getElementById('tg-copy-btn').onclick = () => {
                this._handleCopyClick();
            };
        },

        async _handleRunClick() {
            const prompt = LeetCodeDOMBubble.getEditorContent();
            
            if (!prompt || prompt.trim().length === 0) {
                UIBubble.showError('Editor is empty. Write your prompt first.');
                return;
            }

            // Read from state (single source of truth)
            const provider = UIBubble.state.provider;
            const model = UIBubble.state.model || 'gpt-4o-mini';
            const apiKey = StorageBubble.getAPIKey(provider);

            if (!apiKey) {
                UIBubble.showError('API key not set. Click ⚙️ to configure.');
                return;
            }

            UIBubble.setLoading(true);

            try {
                // Call LLM
                const response = await LLMProxyBubble.callLLM(prompt, provider, model, apiKey);

                // Show result
                UIBubble.showResult(response);

                // Save run (without pass/fail yet)
                const problemId = LeetCodeDOMBubble.getProblemId();
                const run = {
                    problemId,
                    timestamp: Date.now(),
                    prompt,
                    tokens: response.tokens,
                    model: response.model,
                    passed: null,
                    response: response.text
                };

                StorageBubble.saveRun(run);
                
                // Update history
                const history = StorageBubble.getRuns(problemId);
                UIBubble.updateHistory(history);

                // Set editor content to response
                LeetCodeDOMBubble.setEditorContent(response.text);

            } catch (error) {
                UIBubble.showError(error.message || 'Request failed');
                console.error('LLM call failed:', error);
            } finally {
                UIBubble.setLoading(false);
            }
        },

        _handleCopyClick() {
            const response = UIBubble.state.currentRun;
            if (!response) return;

            navigator.clipboard.writeText(response.text).then(() => {
                const btn = document.getElementById('tg-copy-btn');
                const originalText = btn.textContent;
                btn.textContent = '✓ Copied!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            });
        },

        _handleSubmissionResult(result) {
            // Update the last run with pass/fail status
            const problemId = LeetCodeDOMBubble.getProblemId();
            const runs = StorageBubble.getRuns(problemId);
            
            if (runs.length === 0) return;

            const lastRun = runs[runs.length - 1];
            if (lastRun.passed === null) {
                lastRun.passed = result.passed;
                
                // Re-save entire history
                GM_setValue(`token_golf_runs_${problemId}`, JSON.stringify(runs));
                
                // Update UI
                UIBubble.updateHistory(runs);
            }
        }
    };

    // ════════════════════════════════════════════════════════════
    // 🚀 BOOTSTRAP
    // ════════════════════════════════════════════════════════════
    
    // Wait for page to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => App.init());
    } else {
        setTimeout(() => App.init(), 1000);
    }

    // Handle SPA navigation (LeetCode doesn't full reload)
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            if (url.includes('/problems/')) {
                setTimeout(() => App.init(), 500);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });

})();
