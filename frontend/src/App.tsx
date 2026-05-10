import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

const API_BASE = 'http://localhost:3001/api'

interface Source {
  page: number
  score: number
  preview: string
  docName: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}

interface Chat {
  id: string
  title: string
  messages: Message[]
  createdAt: number
}

interface DocInfo {
  id: string
  docName: string
  chunkCount: number
  pageCount: number
  textLength: number
}

function App() {
  const [docs, setDocs] = useState<DocInfo[]>([])
  const [chats, setChats] = useState<Chat[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  
  const [input, setInput] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStep, setUploadStep] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [error, setError] = useState('')
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set())
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Initialization & Local Storage
  useEffect(() => {
    // Theme setup
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark')
    }
    
    // Auth logic
    const storedUserId = localStorage.getItem('docmind-userid')
    if (!storedUserId) {
      fetch(`${API_BASE}/init`).then(res => res.json()).then(data => {
        localStorage.setItem('docmind-userid', data.userId)
        setUserId(data.userId)
      })
    } else {
      setUserId(storedUserId)
    }

    // Load docs from Local Storage
    const storedDocs = localStorage.getItem('docmind-docs')
    if (storedDocs) {
      try {
        setDocs(JSON.parse(storedDocs))
      } catch (e) {}
    }

    // Load chats from Local Storage
    const storedChats = localStorage.getItem('docmind-chats')
    let loadedChats: Chat[] = []
    if (storedChats) {
      try {
        loadedChats = JSON.parse(storedChats)
        setChats(loadedChats)
      } catch (e) {}
    }

    const path = window.location.pathname.slice(1) // remove leading '/'
    if (path && loadedChats.find(c => c.id === path)) {
      setCurrentChatId(path)
    } else if (loadedChats.length > 0) {
      setCurrentChatId(loadedChats[0].id)
      window.history.replaceState(null, '', `/${loadedChats[0].id}`)
    } else {
      const newId = 'chat1'
      const newChat: Chat = { id: newId, title: 'Chat_1', messages: [], createdAt: Date.now() }
      setChats([newChat])
      setCurrentChatId(newId)
      window.history.replaceState(null, '', `/${newId}`)
    }

    const handlePopState = () => {
      const currentPath = window.location.pathname.slice(1)
      if (currentPath) setCurrentChatId(currentPath)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Update theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Save chats to Local Storage
  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem('docmind-chats', JSON.stringify(chats))
    }
  }, [chats])

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chats, currentChatId, isThinking])

  // Save docs to Local Storage
  useEffect(() => {
    localStorage.setItem('docmind-docs', JSON.stringify(docs))
  }, [docs])

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 5000)
      return () => clearTimeout(timer)
    }
  }, [error])



  // --- Chat Functions ---
  const handleNewChat = () => {
    setChats(prev => {
      const nums = prev.map(c => {
        const m = c.title.match(/^Chat_(\d+)$/)
        return m ? parseInt(m[1]) : 0
      })
      const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : 1
      const newId = `chat${nextNum}`
      const newChat: Chat = {
        id: newId,
        title: `Chat_${nextNum}`,
        messages: [],
        createdAt: Date.now()
      }
      setCurrentChatId(newId)
      window.history.pushState(null, '', `/${newId}`)
      return [newChat, ...prev]
    })
  }

  const switchChat = (id: string) => {
    setCurrentChatId(id)
    window.history.pushState(null, '', `/${id}`)
  }

  const handleDeleteChat = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setChats(prev => {
      const filtered = prev.filter(c => c.id !== id)
      if (currentChatId === id) {
        const nextId = filtered.length > 0 ? filtered[0].id : null
        setCurrentChatId(nextId)
        if (nextId) window.history.pushState(null, '', `/${nextId}`)
        else window.history.pushState(null, '', `/`)
      }
      return filtered
    })
  }

  const addMessageToChat = (chatId: string, message: Message) => {
    setChats(prev => prev.map(c => {
      if (c.id === chatId) {
        return { ...c, messages: [...c.messages, message] }
      }
      return c
    }))
  }

  // --- Document Functions ---
  const handleUpload = useCallback(async (file: File) => {
    setIsUploading(true)
    setUploadStep('Parsing document...')
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)

      setUploadStep('Chunking & embedding...')
      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: { 'X-User-Id': userId! },
        body: formData,
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      setUploadStep('Indexing in vector database...')
      await new Promise(r => setTimeout(r, 500))

      // Update local docs
      setDocs(prev => [...prev, {
        id: data.docId,
        docName: data.docName,
        chunkCount: data.chunkCount,
        pageCount: data.pageCount,
        textLength: data.textLength
      }])

      // Add confirmation message to current chat
      if (currentChatId) {
        addMessageToChat(currentChatId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `✅ **${data.docName}** uploaded successfully!\n\nI've analyzed the document and stored it in the database. You can ask me anything about it.`,
        })
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Upload failed'
      setError(errorMsg)
    } finally {
      setIsUploading(false)
      setUploadStep('')
    }
  }, [currentChatId, userId])

  const handleDeleteDoc = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/documents/${id}`, { 
        method: 'DELETE',
        headers: { 'X-User-Id': userId! }
      })
      if (!res.ok) throw new Error('Failed to delete document')
      setDocs(prev => prev.filter(d => d.id !== id))
    } catch (err) {
      console.error(err)
      setError('Failed to delete document')
    }
  }

  // --- Q&A Execution ---
  const handleAsk = useCallback(async () => {
    const question = input.trim()
    if (!question || isThinking) return

    if (docs.length === 0) {
      setError("Please upload at least one document first.")
      return
    }

    let chatId = currentChatId
    if (!chatId) {
      const newId = `chat${chats.length + 1}`
      const newChat: Chat = { id: newId, title: `Chat_${chats.length + 1}`, messages: [], createdAt: Date.now() }
      setChats(prev => [newChat, ...prev])
      setCurrentChatId(newId)
      window.history.pushState(null, '', `/${newId}`)
      chatId = newId
    }

    const chatHistory = chats.find(c => c.id === chatId)?.messages.map(m => ({
      role: m.role,
      content: m.content
    })) || []

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: question }
    addMessageToChat(chatId, userMsg)
    setInput('')
    setIsThinking(true)

    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': userId!
        },
        body: JSON.stringify({ question, chatHistory }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to get answer')

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer,
        sources: data.sources,
      }
      addMessageToChat(chatId, assistantMsg)
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get answer'
      setError(errorMsg)
    } finally {
      setIsThinking(false)
    }
  }, [input, isThinking, docs.length, currentChatId, userId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAsk()
    }
  }, [handleAsk])

  const toggleSources = useCallback((msgId: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev)
      if (next.has(msgId)) next.delete(msgId)
      else next.add(msgId)
      return next
    })
  }, [])

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  const renderContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      let processed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      processed = processed.replace(/`(.*?)`/g, '<code>$1</code>')
      if (processed.startsWith('- ') || processed.startsWith('• ')) {
        return <li key={i} dangerouslySetInnerHTML={{ __html: processed.slice(2) }} />
      }
      if (processed.trim() === '') return <br key={i} />
      return <p key={i} dangerouslySetInnerHTML={{ __html: processed }} />
    })
  }

  const currentChat = chats.find(c => c.id === currentChatId)
  const activeMessages = currentChat?.messages || []

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <div className="header-logo">🧠</div>
          <div>DocMind</div>
        </div>
        <div className="header-actions">
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
          </button>
        </div>
      </header>

      <div className="app-layout">
        {/* --- Sidebar --- */}
        <aside className="sidebar">
          {/* Chat History Section */}
          <div className="sidebar-section">
            <div className="sidebar-header">
              <span className="sidebar-title">Chats</span>
              <button className="add-btn" onClick={handleNewChat} title="New Chat">+</button>
            </div>
            <div className="item-list">
              {chats.length === 0 ? (
                <div className="empty-text">No chat history</div>
              ) : (
                chats.map(chat => (
                  <div 
                    key={chat.id} 
                    className={`sidebar-item ${chat.id === currentChatId ? 'active' : ''}`}
                    onClick={() => switchChat(chat.id)}
                    title={chat.title}
                  >
                    <div className="sidebar-item-content">
                      <span className="item-icon">💬</span>
                      <span className="item-name">{chat.title}</span>
                    </div>
                    <button 
                      className="delete-btn" 
                      onClick={(e) => handleDeleteChat(e, chat.id)}
                      title="Delete chat"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <hr className="sidebar-divider" />

          {/* Documents Section */}
          <div className="sidebar-section">
            <div className="sidebar-header">
              <span className="sidebar-title">Documents</span>
              <button 
                className="add-btn" 
                onClick={() => fileInputRef.current?.click()}
                title="Upload Document"
              >
                +
              </button>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                accept=".pdf,.txt,.md,.csv,.json,.log"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    handleUpload(file)
                    e.target.value = '' // Reset input
                  }
                }}
              />
            </div>
            
            <div className="item-list">
              {docs.length === 0 ? (
                <div className="empty-text">No documents uploaded.</div>
              ) : (
                docs.map(doc => (
                  <div key={doc.id} className="sidebar-item" style={{ cursor: 'default' }} title={doc.docName}>
                    <div className="sidebar-item-content">
                      <span className="item-icon">📄</span>
                      <span className="item-name">{doc.docName}</span>
                    </div>
                    <button 
                      className="delete-btn" 
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteDoc(doc.id)
                      }}
                      title="Delete document"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* --- Main Chat Area --- */}
        <main className="main-chat-area">
          {isUploading && (
            <div className="upload-overlay">
              <div className="spinner" />
              <div style={{ fontWeight: 500 }}>{uploadStep}</div>
            </div>
          )}

          <div className="messages-container">
            {activeMessages.length === 0 && (
              <div className="welcome-message">
                <h2>How can I help you today?</h2>
                <p>Upload documents in the sidebar and ask me anything about them.</p>
              </div>
            )}

            {activeMessages.map((msg) => (
              <div key={msg.id} className={`message message-${msg.role}`}>
                <div className="message-avatar">
                  {msg.role === 'user' ? '👤' : '🧠'}
                </div>
                <div className="message-body">
                  <div className="message-sender">
                    {msg.role === 'user' ? 'You' : 'DocMind'}
                  </div>
                  <div className="message-content">
                    {renderContent(msg.content)}
                  </div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="sources">
                      <button
                        className="sources-toggle"
                        onClick={() => toggleSources(msg.id)}
                      >
                        📚 {msg.sources.length} source{msg.sources.length > 1 ? 's' : ''} {expandedSources.has(msg.id) ? '▲' : '▼'}
                      </button>
                      {expandedSources.has(msg.id) && (
                        <div className="sources-list">
                          {msg.sources.map((src, i) => (
                            <div key={i} className="source-item">
                              <span className="source-page">p.{src.page}</span>
                              <div className="source-preview">
                                <div><strong>{src.docName}</strong> <span className="source-score">· {(src.score * 100).toFixed(0)}% match</span></div>
                                <div>{src.preview}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isThinking && (
              <div className="message message-assistant">
                <div className="message-avatar">🧠</div>
                <div className="message-body">
                  <div className="message-sender">DocMind</div>
                  <div className="thinking-dots">
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-area-container">
            <div className="input-wrapper">
              <textarea
                ref={inputRef}
                className="input-field"
                placeholder={docs.length > 0 ? "Ask a question about your documents..." : "Upload a document to start asking questions..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={isThinking}
              />
              <button
                className="send-btn"
                onClick={handleAsk}
                disabled={!input.trim() || isThinking}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 19V5M12 5L5 12M12 5L19 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </main>
      </div>

      {error && <div className="error-toast">{error}</div>}
    </div>
  )
}

export default App
