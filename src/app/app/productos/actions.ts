"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { InventoryActionState } from "@/components/inventory/action-state";
import {
  isScientificNotationIdentifier,
  normalizeProductIdentifier,
} from "@/lib/product-identifiers";
import {
  databaseErrorState,
  isUuid,
  numberValue,
  optionalNumberValue,
  optionalText,
  optionalUuid,
  requireInventoryContext,
  textValue,
  unauthenticatedState,
} from "@/components/inventory/server-utils";
import type { Database } from "@/types/database";

type ProductInput = {
  barcode: string | null;
  brand_id: string | null;
  category_id: string | null;
  commercial_description: string | null;
  cost_price: number;
  default_supplier_id: string | null;
  description: string | null;
  image_path: string | null;
  is_featured: boolean;
  is_published: boolean;
  hide_when_out_of_stock: boolean;
  min_stock: number;
  target_stock: number | null;
  name: string;
  retail_price: number;
  sku: string;
  seo_description: string | null;
  seo_title: string | null;
  store_slug: string;
  unit: string;
  wholesale_min_quantity: number;
  wholesale_price: number | null;
};

const allowedUnits = new Set([
  "unidad",
  "paquete",
  "caja",
  "bolsa",
  "kit",
  "par",
  "litro",
  "kilogramo",
]);

function parseProduct(formData: FormData): {
  data?: ProductInput;
  errors?: Record<string, string>;
} {
  const name = textValue(formData, "name");
  const rawSku = formData.get("sku");
  const rawBarcode = formData.get("barcode");
  const sku = normalizeProductIdentifier(typeof rawSku === "string" ? rawSku : "");
  const barcodeValue = normalizeProductIdentifier(typeof rawBarcode === "string" ? rawBarcode : "");
  const barcode = barcodeValue || null;
  const unit = textValue(formData, "unit");
  const costPrice = numberValue(formData, "cost_price");
  const retailPrice = numberValue(formData, "retail_price");
  const wholesalePrice = optionalNumberValue(formData, "wholesale_price");
  const wholesaleMinQuantity = numberValue(formData, "wholesale_min_quantity");
  const minStock = numberValue(formData, "min_stock");
  const targetStock = optionalNumberValue(formData, "target_stock");
  const errors: Record<string, string> = {};

  if (name.length < 2 || name.length > 180) {
    errors.name = "Ingresá un nombre de entre 2 y 180 caracteres.";
  }
  if (!sku || sku.length > 80) {
    errors.sku = "Ingresá un SKU de hasta 80 caracteres.";
  } else if (isScientificNotationIdentifier(sku)) {
    errors.sku = "Ingresá el SKU completo; la notación científica no está permitida.";
  }
  if (barcode && barcode.length > 80) {
    errors.barcode = "El código de barras no puede superar 80 caracteres.";
  } else if (barcode && isScientificNotationIdentifier(barcode)) {
    errors.barcode = "Ingresá el código completo; la notación científica no está permitida.";
  }
  if (!allowedUnits.has(unit)) {
    errors.unit = "Seleccioná una unidad válida.";
  }
  if (!Number.isFinite(costPrice) || costPrice < 0) {
    errors.cost_price = "El costo debe ser cero o un importe positivo.";
  }
  if (!Number.isFinite(retailPrice) || retailPrice < 0) {
    errors.retail_price = "El precio debe ser cero o un importe positivo.";
  }
  if (wholesalePrice !== null && (!Number.isFinite(wholesalePrice) || wholesalePrice < 0)) {
    errors.wholesale_price = "El precio mayorista debe ser positivo.";
  }
  if (!Number.isFinite(wholesaleMinQuantity) || wholesaleMinQuantity <= 0) {
    errors.wholesale_min_quantity = "La cantidad mayorista debe ser mayor a cero.";
  }
  if (!Number.isFinite(minStock) || minStock < 0) {
    errors.min_stock = "El stock mínimo debe ser cero o mayor.";
  }
  if (targetStock !== null && (!Number.isFinite(targetStock) || targetStock < minStock)) {
    errors.target_stock = "El stock objetivo debe ser igual o mayor al mínimo.";
  }

  const description = optionalText(formData, "description", 2000);
  const imagePath = optionalText(formData, "image_path", 500);
  const commercialDescription = optionalText(formData, "commercial_description", 4000);
  const seoTitle = optionalText(formData, "seo_title", 70);
  const seoDescription = optionalText(formData, "seo_description", 180);
  const storeSlug = textValue(formData, "store_slug").toLowerCase();
  const categoryId = optionalUuid(formData, "category_id");
  const brandId = optionalUuid(formData, "brand_id");
  const supplierId = optionalUuid(formData, "default_supplier_id");

  if (textValue(formData, "category_id") && !categoryId) errors.category_id = "Categoría inválida.";
  if (textValue(formData, "brand_id") && !brandId) errors.brand_id = "Marca inválida.";
  if (textValue(formData, "default_supplier_id") && !supplierId) {
    errors.default_supplier_id = "Proveedor inválido.";
  }

  if (Object.keys(errors).length) return { errors };

  return {
    data: {
      barcode,
      brand_id: brandId,
      category_id: categoryId,
      commercial_description: commercialDescription,
      cost_price: costPrice,
      default_supplier_id: supplierId,
      description,
      image_path: imagePath,
      is_featured: formData.get("is_featured") === "on",
      is_published: formData.get("is_published") === "on",
      hide_when_out_of_stock: formData.get("hide_when_out_of_stock") === "on",
      min_stock: minStock,
      target_stock: targetStock,
      name,
      retail_price: retailPrice,
      sku,
      seo_description: seoDescription,
      seo_title: seoTitle,
      store_slug: storeSlug,
      unit,
      wholesale_min_quantity: wholesaleMinQuantity,
      wholesale_price: wholesalePrice,
    },
  };
}

async function validateRelations(
  organizationId: string,
  input: ProductInput,
  supabase: SupabaseClient<Database>,
) {
  const [category, brand, supplier] = await Promise.all([
    input.category_id
      ? supabase
          .from("categories")
          .select("id")
          .eq("id", input.category_id)
          .eq("organization_id", organizationId)
          .maybeSingle()
      : Promise.resolve({ data: { id: "" }, error: null }),
    input.brand_id
      ? supabase
          .from("brands")
          .select("id")
          .eq("id", input.brand_id)
          .eq("organization_id", organizationId)
          .maybeSingle()
      : Promise.resolve({ data: { id: "" }, error: null }),
    input.default_supplier_id
      ? supabase
          .from("suppliers")
          .select("id")
          .eq("id", input.default_supplier_id)
          .eq("organization_id", organizationId)
          .maybeSingle()
      : Promise.resolve({ data: { id: "" }, error: null }),
  ]);

  const errors: Record<string, string> = {};
  if (input.category_id && !category.data) errors.category_id = "La categoría ya no está disponible.";
  if (input.brand_id && !brand.data) errors.brand_id = "La marca ya no está disponible.";
  if (input.default_supplier_id && !supplier.data) {
    errors.default_supplier_id = "El proveedor ya no está disponible.";
  }
  return errors;
}

async function validateProductIdentifiers(
  organizationId: string,
  input: ProductInput,
  supabase: SupabaseClient<Database>,
  excludedProductId?: string,
) {
  const ownerQuery = (column: "barcode" | "sku", value: string) => {
    let query = supabase
      .from("products")
      .select("id, name")
      .eq("organization_id", organizationId)
      .eq(column, value);
    if (excludedProductId) query = query.neq("id", excludedProductId);
    return query.limit(1).maybeSingle();
  };

  const [skuOwner, barcodeOwner, barcodeUsedAsSku, skuUsedAsBarcode] = await Promise.all([
    ownerQuery("sku", input.sku),
    input.barcode ? ownerQuery("barcode", input.barcode) : Promise.resolve({ data: null, error: null }),
    input.barcode ? ownerQuery("sku", input.barcode) : Promise.resolve({ data: null, error: null }),
    ownerQuery("barcode", input.sku),
  ]);
  const databaseError = [skuOwner, barcodeOwner, barcodeUsedAsSku, skuUsedAsBarcode]
    .find((result) => result.error)?.error;
  if (databaseError) return { databaseError, errors: {} as Record<string, string> };

  const errors: Record<string, string> = {};
  const conflictingSkuOwner = skuOwner.data ?? skuUsedAsBarcode.data;
  const conflictingBarcodeOwner = barcodeOwner.data ?? barcodeUsedAsSku.data;
  if (conflictingSkuOwner) {
    errors.sku = `Este SKU ya está asociado al producto ${conflictingSkuOwner.name}.`;
  }
  if (conflictingBarcodeOwner) {
    errors.barcode = `Este código de barras ya está asociado al producto ${conflictingBarcodeOwner.name}.`;
  }
  return { databaseError: null, errors };
}

export async function createProductAction(
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const context = await requireInventoryContext();
  if (!context) return unauthenticatedState;

  const parsed = parseProduct(formData);
  if (!parsed.data) {
    return { status: "error", message: "Revisá los campos indicados.", fieldErrors: parsed.errors };
  }

  const [relationErrors, identifierValidation] = await Promise.all([
    validateRelations(context.organization.id, parsed.data, context.supabase),
    validateProductIdentifiers(context.organization.id, parsed.data, context.supabase),
  ]);
  if (identifierValidation.databaseError) return databaseErrorState(identifierValidation.databaseError);
  const productErrors = { ...relationErrors, ...identifierValidation.errors };
  if (Object.keys(productErrors).length) {
    return { status: "error", message: "Revisá los datos del producto.", fieldErrors: productErrors };
  }

  const initialStock = optionalNumberValue(formData, "initial_stock") ?? 0;
  if (!Number.isFinite(initialStock) || initialStock < 0) {
    return {
      status: "error",
      message: "Revisá los campos indicados.",
      fieldErrors: { initial_stock: "El stock inicial debe ser cero o mayor." },
    };
  }

  const { data: product, error } = await context.supabase
    .from("products")
    .insert({ ...parsed.data, current_stock: 0, organization_id: context.organization.id })
    .select("id")
    .single();

  if (error || !product) return databaseErrorState(error ?? { message: "Producto no creado" });

  if (initialStock > 0) {
    const { error: movementError } = await context.supabase.rpc("adjust_inventory", {
      p_organization_id: context.organization.id,
      p_product_id: product.id,
      p_quantity_delta: initialStock,
      p_reason: "Stock inicial al crear el producto",
    });

    if (movementError) {
      await context.supabase
        .from("products")
        .delete()
        .eq("id", product.id)
        .eq("organization_id", context.organization.id);
      return databaseErrorState(movementError);
    }
  }

  revalidatePath("/app/productos");
  revalidatePath("/app");
  redirect(`/app/productos/${product.id}`);
}

export async function updateProductAction(
  productId: string,
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  if (!isUuid(productId)) return { status: "error", message: "Producto inválido." };
  const context = await requireInventoryContext();
  if (!context) return unauthenticatedState;

  const parsed = parseProduct(formData);
  if (!parsed.data) {
    return { status: "error", message: "Revisá los campos indicados.", fieldErrors: parsed.errors };
  }
  const requestedStock = numberValue(formData, "current_stock");
  if (!Number.isFinite(requestedStock) || requestedStock < 0) {
    return {
      status: "error",
      message: "Revisá los campos indicados.",
      fieldErrors: { current_stock: "El stock actual debe ser cero o mayor." },
    };
  }
  const [relationErrors, identifierValidation] = await Promise.all([
    validateRelations(context.organization.id, parsed.data, context.supabase),
    validateProductIdentifiers(context.organization.id, parsed.data, context.supabase, productId),
  ]);
  if (identifierValidation.databaseError) return databaseErrorState(identifierValidation.databaseError);
  const productErrors = { ...relationErrors, ...identifierValidation.errors };
  if (Object.keys(productErrors).length) {
    return { status: "error", message: "Revisá los datos del producto.", fieldErrors: productErrors };
  }

  const { data, error } = await context.supabase
    .from("products")
    .update(parsed.data)
    .eq("id", productId)
    .eq("organization_id", context.organization.id)
    .select("id, current_stock")
    .maybeSingle();

  if (error) return databaseErrorState(error);
  if (!data) return { status: "error", message: "El producto no existe o no tenés acceso." };

  const stockDelta = requestedStock - Number(data.current_stock);
  if (Math.abs(stockDelta) > 0.000_001) {
    const { error: movementError } = await context.supabase.rpc("adjust_inventory", {
      p_organization_id: context.organization.id,
      p_product_id: productId,
      p_quantity_delta: stockDelta,
      p_reason: `Stock total actualizado desde la edición del producto a ${requestedStock}`,
    });
    if (movementError) {
      revalidatePath("/app/productos");
      revalidatePath(`/app/productos/${productId}`);
      revalidatePath(`/app/productos/${productId}/editar`);
      revalidatePath("/app");
      return {
        status: "error",
        message: "Los datos del producto se guardaron, pero el stock no pudo actualizarse. Volvé a intentarlo.",
      };
    }
  }

  revalidatePath("/app/productos");
  revalidatePath(`/app/productos/${productId}`);
  revalidatePath(`/app/productos/${productId}/editar`);
  revalidatePath("/app");
  return {
    status: "success",
    message: stockDelta === 0
      ? "Producto actualizado correctamente."
      : "Producto y stock actualizados correctamente.",
  };
}

export async function updateProductSupplierAction(
  productId: string,
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  if (!isUuid(productId)) return { status: "error", message: "Producto inválido." };

  const context = await requireInventoryContext();
  if (!context) return unauthenticatedState;

  const rawSupplierId = textValue(formData, "default_supplier_id");
  const supplierId = optionalUuid(formData, "default_supplier_id");

  if (rawSupplierId && !supplierId) {
    return {
      status: "error",
      message: "Seleccioná un proveedor válido.",
      fieldErrors: { default_supplier_id: "El proveedor seleccionado no es válido." },
    };
  }

  if (supplierId) {
    const { data: supplier, error: supplierError } = await context.supabase
      .from("suppliers")
      .select("id, is_active")
      .eq("id", supplierId)
      .eq("organization_id", context.organization.id)
      .maybeSingle();

    if (supplierError) return databaseErrorState(supplierError);
    if (!supplier?.is_active) {
      return {
        status: "error",
        message: "El proveedor no está disponible.",
        fieldErrors: { default_supplier_id: "Elegí un proveedor activo." },
      };
    }
  }

  const { data: product, error } = await context.supabase
    .from("products")
    .update({ default_supplier_id: supplierId })
    .eq("id", productId)
    .eq("organization_id", context.organization.id)
    .select("id")
    .maybeSingle();

  if (error) return databaseErrorState(error);
  if (!product) return { status: "error", message: "El producto no existe o no tenés acceso." };

  revalidatePath("/app/productos");
  revalidatePath(`/app/productos/${productId}`);
  revalidatePath("/app/compras");
  revalidatePath("/app/proveedores");
  revalidatePath("/app");

  return {
    status: "success",
    message: supplierId
      ? "Proveedor asignado correctamente."
      : "El producto quedó sin proveedor asignado.",
  };
}

export async function toggleProductStatusAction(productId: string) {
  if (!isUuid(productId)) return;
  const context = await requireInventoryContext();
  if (!context) return;

  const { data: product } = await context.supabase
    .from("products")
    .select("is_active")
    .eq("id", productId)
    .eq("organization_id", context.organization.id)
    .maybeSingle();
  if (!product) return;

  const { error } = await context.supabase
    .from("products")
    .update({ is_active: !product.is_active })
    .eq("id", productId)
    .eq("organization_id", context.organization.id);
  if (error) throw new Error(databaseErrorState(error).message);

  revalidatePath("/app/productos");
  revalidatePath(`/app/productos/${productId}`);
  revalidatePath("/app/compras");
  revalidatePath("/app/ventas");
  revalidatePath("/app");
}

export async function createStockMovementAction(
  productId: string,
  _previousState: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  if (!isUuid(productId)) return { status: "error", message: "Producto inválido." };
  const context = await requireInventoryContext();
  if (!context) return unauthenticatedState;

  const operation = textValue(formData, "operation");
  const quantity = numberValue(formData, "quantity");
  const unitCost = optionalNumberValue(formData, "unit_cost");
  const notes = optionalText(formData, "notes", 500);
  const errors: Record<string, string> = {};

  if (!new Set(["entry", "exit", "adjustment"]).has(operation)) {
    errors.operation = "Seleccioná un tipo de movimiento.";
  }
  if (!Number.isFinite(quantity) || quantity === 0) {
    errors.quantity = "Ingresá una cantidad distinta de cero.";
  }
  if (operation !== "adjustment" && quantity < 0) {
    errors.quantity = "Para entradas y salidas ingresá una cantidad positiva.";
  }
  if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
    errors.unit_cost = "El costo debe ser cero o mayor.";
  }
  if (Object.keys(errors).length) {
    return { status: "error", message: "Revisá los campos indicados.", fieldErrors: errors };
  }

  const { data: product } = await context.supabase
    .from("products")
    .select("id, current_stock")
    .eq("id", productId)
    .eq("organization_id", context.organization.id)
    .maybeSingle();
  if (!product) return { status: "error", message: "El producto no existe o no tenés acceso." };

  let quantityDelta = quantity;
  if (operation === "entry") {
    quantityDelta = Math.abs(quantity);
  } else if (operation === "exit") {
    quantityDelta = -Math.abs(quantity);
  }

  if (Number(product.current_stock) + quantityDelta < 0) {
    return {
      status: "error",
      message: "El movimiento dejaría el stock en negativo. Revisá la cantidad disponible.",
      fieldErrors: { quantity: "La cantidad supera el stock actual." },
    };
  }

  const reason = notes ?? (
    operation === "entry"
      ? "Entrada manual de stock"
      : operation === "exit"
        ? "Salida manual de stock"
        : "Ajuste manual de stock"
  );
  const { error } = await context.supabase.rpc("adjust_inventory", {
    p_organization_id: context.organization.id,
    p_product_id: productId,
    p_quantity_delta: quantityDelta,
    p_reason: reason,
    p_unit_cost: unitCost ?? undefined,
  });
  if (error) return databaseErrorState(error);

  revalidatePath("/app/productos");
  revalidatePath(`/app/productos/${productId}`);
  revalidatePath("/app");
  return { status: "success", message: "Movimiento registrado y stock actualizado." };
}
