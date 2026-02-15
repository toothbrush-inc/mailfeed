"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { X, Send, Loader2, MessageCircle, ExternalLink, Mail, KeyRound } from "lucide-react"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  sources?: Array<{
    id: string
    title: string
    url: string
    type: "link" | "email"
  }>
}

interface ChatModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ChatModal({ isOpen, onClose }: ChatModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [geminiNotConfigured, setGeminiNotConfigured] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: userMessage }])
    setIsLoading(true)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.code === "GEMINI_NOT_CONFIGURED") {
          setGeminiNotConfigured(true)
          // Remove the user message we just added
          setMessages((prev) => prev.slice(0, -1))
          return
        }
        throw new Error(data.error || "Failed to get response")
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response,
          sources: data.sources,
        },
      ])
    } catch (error) {
      console.error("Chat error:", error)
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Chat panel */}
      <div className="flex flex-col w-[400px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-6rem)] bg-background border rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Ask about your content</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {geminiNotConfigured && (
            <div className="text-center py-8 px-4">
              <KeyRound className="h-12 w-12 mx-auto mb-4 text-amber-500 opacity-80" />
              <p className="text-sm font-medium">Gemini API Key Required</p>
              <p className="text-xs text-muted-foreground mt-2">
                To use AI chat, add a <code className="bg-muted px-1 py-0.5 rounded text-xs">GEMINI_API_KEY</code> to your <code className="bg-muted px-1 py-0.5 rounded text-xs">.env</code> file and restart the server.
              </p>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-3"
              >
                Get a key from Google AI Studio
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {!geminiNotConfigured && messages.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">
                Ask questions about your saved links and emails.
              </p>
              <p className="text-xs mt-2 opacity-70">
                Try: &quot;Summarize articles about AI&quot; or &quot;What did I save about productivity?&quot;
              </p>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                "flex flex-col gap-2",
                message.role === "user" ? "items-end" : "items-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-xl px-4 py-2",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              </div>

              {/* Sources */}
              {message.sources && message.sources.length > 0 && (
                <div className="max-w-[85%] space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">
                    Sources:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {message.sources.slice(0, 5).map((source) => (
                      <a
                        key={source.id}
                        href={source.type === "email" ? undefined : source.url}
                        target={source.type === "email" ? undefined : "_blank"}
                        rel="noopener noreferrer"
                        className={cn(
                          "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full",
                          "bg-secondary text-secondary-foreground",
                          source.type !== "email" && "hover:bg-secondary/80 cursor-pointer"
                        )}
                      >
                        {source.type === "email" ? (
                          <Mail className="h-3 w-3" />
                        ) : (
                          <ExternalLink className="h-3 w-3" />
                        )}
                        <span className="truncate max-w-[150px]">
                          {source.title}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex items-start">
              <div className="bg-muted rounded-xl px-4 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t bg-background">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your saved content..."
              disabled={isLoading || geminiNotConfigured}
              className="flex-1"
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading || geminiNotConfigured}
              size="icon"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
