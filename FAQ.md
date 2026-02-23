# FAQ

### Will MailFeed read my email?

No. MailFeed only accesses emails matching your configured query (by default, emails you send to yourself). It does not read, store, or transmit your other emails. Don't take our word for it — the code is open source so you can verify exactly what it does. In fact, that's why MailFeed is designed to be self-hosted.

### What emails does it sync?

By default, MailFeed syncs self-sent emails (`from:me to:me`). You can change this to any Gmail query you want in Settings. For example, you could sync emails from a specific sender, with a specific label, or matching any search query that works in Gmail.

### How many emails does it sync at a time?

To keep sync times reasonable, MailFeed pulls in roughly 250 emails per sync by default. This is configurable in Sync Settings. You can run sync multiple times to pull in older emails progressively.

### What does the content fallback do?

Many links go stale over time — pages get taken down, URLs change, or content moves behind paywalls. When MailFeed can't fetch content directly, it falls back to the Wayback Machine to find an archived snapshot of the page.

### I keep getting calendar links that aren't useful. Can I hide them?

Yes! You can block an entire domain from appearing in your feed. Go to the Domains page in Settings, or click the "hide" button on any link in the feed to hide all links from that domain.

### Where's the mobile app?

There isn't one yet. If there's enough interest we'll consider it. For now, MailFeed is best enjoyed on the big screen of your computer.

### Where are the AI features?

Right now you can chat with the content you've embedded from your emails and links, which can be a fun way to search and rediscover things you've saved. We have more AI-enhanced features in the pipeline — stay tuned.

### Why do I have to self-host? Can't you just run a service I can use?

Beyond the trust issue of handing over your email data (see the first question), running a hosted service requires significant effort and capital to operate. We don't yet know how many people are like us and send themselves emails all day. If that number turns out to be high, then maybe!
