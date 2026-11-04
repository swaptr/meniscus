import { createFileRoute } from '@tanstack/react-router'

// No redirect here: the session gate sends `/` to the signed-in person's landing page (/a or /n).
export const Route = createFileRoute('/')({
  component: () => null,
})
