"use client"

import { useState } from "react"
import { useDomains } from "@/hooks/use-domains"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowDownAZ, ArrowDownWideNarrow, Eye, EyeOff, Loader2, Search } from "lucide-react"

export default function DomainsPage() {
  const { domains, isLoading, hideDomain, unhideDomain } = useDomains()
  const [loadingDomain, setLoadingDomain] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [showHiddenOnly, setShowHiddenOnly] = useState(false)
  const [sortBy, setSortBy] = useState<"count" | "alpha">("count")

  const handleToggleHidden = async (domain: string, isHidden: boolean) => {
    setLoadingDomain(domain)
    if (isHidden) {
      await unhideDomain(domain)
    } else {
      await hideDomain(domain)
    }
    setLoadingDomain(null)
  }

  const filteredDomains = domains
    .filter((d) => {
      const matchesSearch = d.domain.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesFilter = showHiddenOnly ? d.isHidden : true
      return matchesSearch && matchesFilter
    })
    .sort((a, b) =>
      sortBy === "count"
        ? b.count - a.count
        : a.domain.localeCompare(b.domain)
    )

  const hiddenCount = domains.filter((d) => d.isHidden).length

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Domains</h2>
        <p className="text-muted-foreground">
          Manage which domains appear in your feed. Hidden domains won&apos;t show up in your links.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Domain Management</CardTitle>
          <CardDescription>
            {domains.length} domains · {hiddenCount} hidden
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search domains..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortBy(sortBy === "count" ? "alpha" : "count")}
            >
              {sortBy === "count" ? (
                <>
                  <ArrowDownWideNarrow className="mr-1 h-4 w-4" />
                  By count
                </>
              ) : (
                <>
                  <ArrowDownAZ className="mr-1 h-4 w-4" />
                  A–Z
                </>
              )}
            </Button>
            <Button
              variant={showHiddenOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setShowHiddenOnly(!showHiddenOnly)}
            >
              <EyeOff className="mr-1 h-4 w-4" />
              Hidden only
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredDomains.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {searchQuery ? "No domains match your search" : "No domains found"}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredDomains.map((d) => (
                <div
                  key={d.domain}
                  className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                    d.isHidden ? "bg-muted/50 opacity-60" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate ${d.isHidden ? "line-through" : ""}`}>
                      {d.domain}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {d.count} link{d.count !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <Button
                    variant={d.isHidden ? "default" : "ghost"}
                    size="sm"
                    onClick={() => handleToggleHidden(d.domain, d.isHidden)}
                    disabled={loadingDomain === d.domain}
                  >
                    {loadingDomain === d.domain ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : d.isHidden ? (
                      <>
                        <Eye className="mr-1 h-4 w-4" />
                        Show
                      </>
                    ) : (
                      <>
                        <EyeOff className="mr-1 h-4 w-4" />
                        Hide
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
