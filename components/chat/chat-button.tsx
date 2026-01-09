"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { MessageCircle } from "lucide-react"
import { ChatModal } from "./chat-modal"

export function ChatButton() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        size="icon"
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-40 hover:scale-105 transition-transform"
      >
        <MessageCircle className="h-6 w-6" />
        <span className="sr-only">Open chat</span>
      </Button>

      <ChatModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}
