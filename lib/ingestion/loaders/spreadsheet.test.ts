import { describe, expect, it } from "vitest"
import { rowsToText } from "./spreadsheet"

describe("rowsToText", () => {
  it("renders each row as a 'Header: value' sentence", () => {
    const text = rowsToText(["Name", "Age"], [["Ada", "36"], ["Grace", "85"]])
    expect(text).toBe("Name: Ada, Age: 36\nName: Grace, Age: 85")
  })

  it("skips rows that are entirely blank", () => {
    const text = rowsToText(["Name", "Age"], [["Ada", "36"], ["", ""], ["Grace", "85"]])
    expect(text).toBe("Name: Ada, Age: 36\nName: Grace, Age: 85")
  })

  it("fills a missing trailing cell with an empty string rather than throwing", () => {
    const text = rowsToText(["Name", "Age", "City"], [["Ada", "36"]])
    expect(text).toBe("Name: Ada, Age: 36, City: ")
  })

  it("returns an empty string for no data rows", () => {
    expect(rowsToText(["Name", "Age"], [])).toBe("")
  })
})
