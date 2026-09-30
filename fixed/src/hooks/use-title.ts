import { useEffect } from "react"

export function useTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — Nordaloom` : "Nordaloom — Knitwear from Latvia"
  }, [title])
}
