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

    // Readability parses the raw fetched HTML — it never runs the page's own
    // JS, so client-rendered (SPA) pages whose initial HTML is essentially
    // empty (e.g. a bare `<div id="root">`) will always fail here. Detect
    // that case specifically so the error says why, instead of a generic
    // "couldn't extract content" that reads like a parser bug.
    const bodyClone = dom.window.document.body?.cloneNode(true) as HTMLElement | undefined
    bodyClone?.querySelectorAll("script, style, noscript").forEach((el) => el.remove())
    const rawBodyText = bodyClone?.textContent?.replace(/\s+/g, " ").trim() ?? ""

    const article = new Readability(dom.window.document).parse()
    const text = article?.textContent?.trim()

    if (!text) {
      if (rawBodyText.length < 200) {
        throw new Error(
          "this page appears to render its content with JavaScript after load — its initial HTML has almost no text, so a plain fetch can't see it. Client-rendered pages aren't supported yet."
        )
      }
      throw new Error("could not extract readable content from page")
    }

    return { kind: "text", text }
  },
}
