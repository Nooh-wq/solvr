import { listAllCategories } from "@/actions/admin";
import { CategoriesManager } from "./categories-manager";

export default async function CategoriesPage() {
  const categories = await listAllCategories();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Categories</h1>
      <CategoriesManager
        categories={categories.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive }))}
      />
    </div>
  );
}
