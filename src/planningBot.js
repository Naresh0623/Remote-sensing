import React, { useCallback, useEffect, useState } from 'react';

const PlanningBot = ({ wardLookup = {} }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: 'Hello, I am your planning assistant. Try: compare ward 28 and ward 51, low-cost housing options, alternatives near ward 40.',
      color: '#00ffff'
    }
  ]);
  const [loading, setLoading] = useState(false);

  const emitBotStatus = useCallback((payload) => {
    window.dispatchEvent(new CustomEvent('botStatus', { detail: payload }));
  }, []);

  const resolveWardValue = useCallback((rawValue) => {
    const trimmed = String(rawValue || '').trim();
    if (!trimmed) return null;

    const directMatch = trimmed.match(/\d+/);
    if (directMatch) {
      return directMatch[0];
    }

    const normalized = trimmed.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (wardLookup[normalized]) {
      return wardLookup[normalized];
    }

    const partialMatchKey = Object.keys(wardLookup).find((key) => {
      return key.includes(normalized) || normalized.includes(key);
    });

    return partialMatchKey ? wardLookup[partialMatchKey] : null;
  }, [wardLookup]);

  const sendMessage = useCallback(async (rawValue = input, botPrompt = false, source = 'chat') => {
    if (!String(rawValue || '').trim()) return;

    const prompt = String(rawValue).trim();
    if (!botPrompt) {
      setMessages((prev) => [...prev, { role: 'user', text: prompt }]);
    }
    setInput('');

    const resolvedWard = resolveWardValue(prompt);
    const chatMessage = resolvedWard ? `Analyze ward ${resolvedWard}` : prompt;

    setLoading(true);
    emitBotStatus({
      type: 'loading',
      status: 'Analyzing',
      recommendation: resolvedWard
        ? `Checking suitability for Ward ${resolvedWard}...`
        : 'Preparing planning response...',
      color: '#00e5ff',
      source
    });

    try {
      const res = await fetch('/api/recommend/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: chatMessage })
      });

      const data = await res.json();
      if (!res.ok) {
        const errorPayload = {
          status: data.status || 'Error',
          recommendation: data.answer || data.recommendation || 'Unable to analyze this site right now.',
          color: data.color || '#ff5252'
        };
        setMessages((prev) => [...prev, { role: 'assistant', text: errorPayload.recommendation, color: errorPayload.color }]);
        emitBotStatus({ type: 'error', source, ...errorPayload });
        return;
      }

      const successPayload = {
        status: data.status || 'Result',
        recommendation: data.answer || data.recommendation || 'Analysis complete.',
        color: data.color || '#00ffff'
      };
      setMessages((prev) => [...prev, { role: 'assistant', text: successPayload.recommendation, color: successPayload.color }]);
      emitBotStatus({ type: 'success', source, ...successPayload });
    } catch (error) {
      console.error('Bot Error:', error);
      const networkPayload = {
        status: 'Network Error',
        recommendation: 'Could not reach the backend API. Ensure server is running on port 5000.',
        color: '#ff5252'
      };
      setMessages((prev) => [...prev, { role: 'assistant', text: networkPayload.recommendation, color: networkPayload.color }]);
      emitBotStatus({ type: 'error', source, ...networkPayload });
    } finally {
      setLoading(false);
    }
  }, [emitBotStatus, input, resolveWardValue]);

  useEffect(() => {
    const handleBotSearch = (event) => {
      const searchValue = String(event?.detail || '').trim();
      if (!searchValue) return;

      const queuedPrompt = `Analyze ward ${searchValue}`;
      setInput(queuedPrompt);

      // Respect manual-open behavior: only auto-analyze if the bot is already open.
      if (isOpen) {
        sendMessage(queuedPrompt, true, 'map');
      }
    };

    window.addEventListener('botSearch', handleBotSearch);
    return () => window.removeEventListener('botSearch', handleBotSearch);
  }, [isOpen, sendMessage]);

  return (
    <div style={{ position: 'fixed', bottom: '25px', right: '25px', zIndex: 10000, fontFamily: 'sans-serif' }}>
      {isOpen && (
        <div style={{
          width: '340px', backgroundColor: '#121212', borderRadius: '15px',
          border: '1px solid #00ffff', padding: '20px', color: 'white',
          boxShadow: '0 10px 30px rgba(0,0,0,0.8)', marginBottom: '15px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h4 style={{ margin: 0, color: '#00ffff', fontSize: '1.1rem' }}>Planning Assistant</h4>
            <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '18px' }}>✕</button>
          </div>

          <div style={{ maxHeight: '260px', overflowY: 'auto', paddingRight: '4px' }}>
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                style={{
                  marginBottom: '10px',
                  display: 'flex',
                  justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start'
                }}
              >
                <div
                  style={{
                    maxWidth: '86%',
                    padding: '9px 10px',
                    borderRadius: '9px',
                    fontSize: '0.82rem',
                    lineHeight: '1.35',
                    backgroundColor: message.role === 'user' ? '#0c4a6e' : '#1e1e1e',
                    borderLeft: message.role === 'assistant' ? `3px solid ${message.color || '#00ffff'}` : 'none'
                  }}
                >
                  {message.text}
                </div>
              </div>
            ))}
            {loading && (
              <p style={{ margin: '4px 0 8px', color: '#9ca3af', fontSize: '0.78rem' }}>Assistant is thinking...</p>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <input
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #333', backgroundColor: '#1e1e1e', color: 'white', boxSizing: 'border-box' }}
              placeholder="Ask: Is ward 28 feasible for housing?"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  sendMessage();
                }
              }}
            />
            <button
              onClick={() => sendMessage()}
              style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: '#00ffff', color: '#000', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}
              disabled={loading}
            >
              Send
            </button>
          </div>
        </div>
      )}

      <button 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '60px', height: '60px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #00ffff, #0080ff)',
          border: 'none', cursor: 'pointer', fontSize: '30px',
          boxShadow: '0 5px 15px rgba(0, 255, 255, 0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}
      >
        🤖
      </button>
    </div>
  );
};

export default PlanningBot;