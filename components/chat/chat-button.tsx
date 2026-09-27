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
        className="fixed bottom-4 right-4 h-12 w-12 md:bottom-6 md:right-6 md:h-14 md:w-14 rounded-full shadow-lg z-40 hover:scale-105 transition-transform"
      >
        <MessageCircle className="h-6 w-6" />
        <span className="sr-only">Open chat</span>
      </Button>

      <ChatModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}
