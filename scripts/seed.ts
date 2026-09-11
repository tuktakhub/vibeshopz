/**
 * Inserts two example products so the catalogue is not empty while you test.
 * Does nothing if the products table already has rows.
 *
 *   npm run db:seed
 */
import { countProducts, createProduct, listProducts } from "../src/repository";
import { ensureSchema } from "../src/db";

async function main(): Promise<void> {
  await ensureSchema();

  const existing = await countProducts(false);
  if (existing > 0) {
    console.log(`Skipped: the catalogue already has ${existing} product(s).`);
    return;
  }

  await createProduct({
    name: "Starter Notion Template Pack",
    description:
      "12 ready-to-use Notion templates for freelancers: client tracker, invoice log, content calendar and more. Delivered as a link you can duplicate into your own workspace.",
    price: 499,
    currency: "",
    category: "Templates",
    deliveryType: "text",
    fileId: null,
    fileName: null,
    deliveryText:
      "Your Notion template pack is ready.\n\nDuplicate it here: https://example.com/your-template-link\n\nReply to this chat if the link does not open.",
    stock: null,
  });

  await createProduct({
    name: "Canva Social Media Kit",
    description:
      "40 editable Canva templates for Instagram and Facebook posts. Sent as a PDF with your access link.",
    price: 799,
    currency: "",
    category: "Design",
    deliveryType: "both",
    fileId: null,
    fileName: null,
    deliveryText:
      "Thanks for your purchase. Your Canva kit link: https://example.com/canva-kit",
    stock: 25,
  });

  const products = await listProducts({ activeOnly: false, limit: 10, offset: 0 });
  console.log(`Seeded ${products.length} products:`);
  for (const product of products) {
    console.log(`  #${product.id} ${product.name} — ${product.price}`);
  }
  console.log(
    "\nNote: the second product is a file+text product, so attach a document to it"
  );
  console.log("from /admin -> Products before approving a real order.");
}

main().catch((error) => {
  console.error("db:seed failed:", error);
  process.exit(1);
});
