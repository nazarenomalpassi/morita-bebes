# Morita Bebés · Gestión y tienda online

### Operación comercial y e-commerce en una aplicación web

Sistema para un comercio de productos para bebés: inventario, ventas, compras y reportes, conectado con un catálogo minorista y mayorista.

**Next.js 16 · React 19 · TypeScript · Tailwind CSS · Supabase / PostgreSQL**

[Visitar la tienda](https://morita-bebes.vercel.app/tienda) · [Mi perfil](https://github.com/nazarenomalpassi) · [LinkedIn](https://www.linkedin.com/in/nazareno-malpassi-8813bb1bb/)

## Gestión del comercio

- Productos, categorías, marcas, proveedores y movimientos de stock.
- Ventas, medios de pago y comprobantes internos en PDF.
- Compras y recepción de mercadería.
- Gastos, personal y reportes de administración.
- Usuarios y permisos según su función.
- Exportaciones e importación de inventario.

## Tienda online

- Catálogo público con disponibilidad de productos.
- Precios minoristas y mayoristas.
- Cuentas de clientes, carrito y pedidos por WhatsApp.
- Interfaz adaptable a celulares y computadoras.

## Desarrollo local

Requiere **Node.js 22 o posterior**, **pnpm** y un entorno propio de Supabase. Para ejecutar Supabase local y sus pruebas SQL también necesitás Docker.

```bash
git clone https://github.com/nazarenomalpassi/morita-bebes.git
cd morita-bebes
pnpm install --frozen-lockfile
```

Copiá `.env.example` a `.env.local` y completá los valores de tu entorno de desarrollo. El esquema está versionado en `supabase/migrations/` y la semilla local no contiene datos comerciales.

```bash
pnpm dev
```

Abrí [localhost:3000](http://localhost:3000). La tienda está en `/tienda`; la gestión requiere acceso autenticado. No se incluyen usuarios ni credenciales del comercio.

## Estructura

```text
src/app/        Rutas, páginas y acciones
src/components/ Componentes de gestión y tienda
src/lib/        Lógica, validaciones e integración de datos
public/         Recursos estáticos y de marca
supabase/       Migraciones, configuración local y pruebas SQL
scripts/        Herramientas auxiliares
```

## Comprobaciones disponibles

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Las pruebas de base de datos se ejecutan por separado contra un entorno local de desarrollo.

## Sobre el proyecto

Desarrollado por **Nazareno Malpassi**, estudiante avanzado de Programación en UTN San Nicolás, con herramientas de IA como apoyo al desarrollo. Despliegue en Vercel.

Esta copia para el portfolio incluye código, migraciones y pruebas. Excluye credenciales, planillas, reportes internos y scripts puntuales de conciliación del negocio.
