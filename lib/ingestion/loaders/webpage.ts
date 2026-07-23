import { JSDOM } from "jsdom"
import { Readability } from "@mozilla/readability"
import { SourceLoader } from "../types"

export const webpageLoader: SourceLoader = {
  type: "webpage",
  async load({ url }) {
    if (!url) throw new Error("webpage loader requires a url")

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AdvancedRAG/1.0)" },
    })
    if (!res.ok) throw new Error(`failed to fetch ${url}: HTTP ${res.status}`)
    const html = await res.text()

    const dom = new JSDOM(html, { url })
    const article = new Readability(dom.window.document).parse()
    const text = article?.textContent?.trim()
    if (!text) throw new Error("could not extract readable content from page")

    return { kind: "text", text }
  },
}
