import { listCategories } from "@/actions/tickets";
import { NewTicketForm } from "./new-ticket-form";

export default async function NewTicketPage() {
  const categories = await listCategories();
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-6">New ticket</h1>
      <NewTicketForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}
