export type ActionState = {
  error?: string;
  message?: string;
};

export function textField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function optionalText(formData: FormData, name: string) {
  return textField(formData, name) || null;
}

export function numberField(formData: FormData, name: string) {
  const value = textField(formData, name).replace(",", ".");
  return value === "" ? Number.NaN : Number(value);
}

export function optionalUuid(formData: FormData, name: string) {
  const value = textField(formData, name);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : null;
}

export function friendlyDatabaseError(error: { code?: string; message: string }) {
  if (error.message.includes("Daily cash closure is required")) {
    return "Hay un cierre de caja anterior pendiente. Completalo antes de registrar nuevas operaciones.";
  }
  if (error.message.includes("Daily cash closure already exists")) {
    return "Ese día ya fue cerrado y no admite nuevas operaciones.";
  }
  if (error.message.includes("oldest pending business date")) {
    return "Primero tenés que completar el cierre diario más antiguo que está pendiente.";
  }
  if (error.message.includes("Invalid daily cash closure date")) {
    return "La fecha del cierre no es válida o todavía no corresponde cerrarla.";
  }
  if (error.message.includes("Counted balances") || error.message.includes("counted balance")) {
    return "Ingresá un saldo válido para cada medio de pago activo.";
  }
  if (error.message.includes("Cash tracking must be configured")) {
    return "Primero hay que configurar los saldos iniciales de caja.";
  }
  if (error.message.includes("Payment date belongs to a closed cash day")) {
    return "Esa fecha ya tiene un cierre de caja. Elegí un día que todavía esté abierto.";
  }
  if (error.message.includes("Advance exceeds the salary generated")) {
    return "El adelanto supera el sueldo generado para ese período.";
  }
  if (error.message.includes("Salary conditions are not configured")) {
    return "Primero configurá el sueldo de la empleada para ese mes.";
  }
  if (error.message.includes("Salary advances must be registered in Personal")) {
    return "Los adelantos de sueldo se registran desde Personal.";
  }
  if (error.message.includes("Salary payments use Cash or Transfer")) {
    return "Para sueldos usá Efectivo o Transferencia.";
  }
  if (error.message.includes("A settled period cannot be changed")) {
    return "No se puede anular un adelanto incluido en una liquidación cerrada.";
  }
  if (error.message.includes("Payroll payment allocations must equal")) {
    return "La suma de los medios de pago debe coincidir exactamente con el sueldo liquidado.";
  }
  if (error.message.includes("Payroll payment allocations are invalid")) {
    return "Revisá los medios de pago y sus importes.";
  }
  if (error.message.includes("Only a paid settlement can be cancelled")) {
    return "Solo se puede anular una liquidación ya pagada.";
  }
  if (error.message.includes("The current cash day is already closed")) {
    return "La caja de hoy ya está cerrada. La corrección debe hacerse en un día abierto.";
  }
  if (error.message.includes("A cancellation reason is required")) {
    return "Escribí un motivo de anulación de al menos tres caracteres.";
  }
  if (error.message.includes("Salary expenses require an employee")) {
    return "Elegí la empleada y el mes donde se descontará el adelanto.";
  }
  if (error.message.includes("Only administrators can register salary advances")) {
    return "Solo un administrador puede registrar adelantos de sueldo.";
  }
  if (error.message.includes("cannot be changed after its payroll period was settled")) {
    return "Ese adelanto ya forma parte de una liquidación cerrada y no puede modificarse.";
  }
  if (error.message.includes("advances and deductions exceed")) {
    return "Los adelantos y descuentos superan el sueldo del período. Revisá las asignaciones antes de liquidar.";
  }
  if (error.code === "23514" && error.message.includes("active owner")) {
    return "El comercio debe conservar al menos un dueño activo.";
  }
  if (error.message.includes("period must be closed")) {
    return "El período debe haber finalizado antes de liquidar el sueldo.";
  }
  if (error.message.includes("already settled")) {
    return "Ese sueldo ya fue liquidado para el período seleccionado.";
  }
  if (error.message.includes("No compensation")) {
    return "Primero configurá las condiciones salariales para ese período.";
  }
  if (error.code === "23505") return "Ya existe un registro con esos datos.";
  if (error.code === "23503") {
    return "No se puede completar porque el registro está siendo utilizado.";
  }
  if (error.code === "42501") return "No tenés permisos para hacer este cambio.";
  if (error.code === "P0002") return "El registro ya no existe o no está disponible.";
  return "No pudimos guardar los cambios. Revisá los datos e intentá nuevamente.";
}
