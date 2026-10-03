import { createFileRoute } from '@tanstack/react-router'
import { ContactsPage } from '@/components/app/contacts-page'

export const Route = createFileRoute('/app/contacts')({
  component: ContactsPage,
})