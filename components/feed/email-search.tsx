"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"

export function EmailSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentSearch = searchParams.get("search") || ""
  const [inputValue, setInputValue] = useState(currentSearch)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // Sync input with URL when URL changes externally
  useEffect(() => {
    setInputValue(currentSearch)
  }, [currentSearch])

  const updateUrl = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value.trim()) {
      params.set("search", value.trim())
    } else {
      params.delete("search")
    }
    params.delete("page") // Reset to page 1 when searching
    const queryString = params.toString()
    router.replace(`${pathname}${queryString ? `?${queryString}` : ""}`)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)

    // Clear existing timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // Set new timeout for debounced search (longer delay for smoother typing)
    debounceRef.current = setTimeout(() => {
      updateUrl(value)
    }, 600)
  }

  const handleClear = () => {
    setInputValue("")
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    updateUrl("")
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      updateUrl(inputValue)
    }
  }

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        placeholder="Search emails by subject, content, links..."
        value={inputValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="pl-9 pr-9"
      />
      {inputValue && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
