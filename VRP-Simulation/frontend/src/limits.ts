export const MAX_CLIENTS = 999;
export const MAX_VEHICLES = 100;

export function instanceSizeError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('clients' in value) || !Array.isArray(value.clients))
    return 'O cenário deve conter uma lista de clientes.';
  if (value.clients.length > MAX_CLIENTS)
    return `O cenário aceita no máximo ${MAX_CLIENTS} clientes e um depósito.`;
  if (!('vehicles' in value) || !Number.isSafeInteger(value.vehicles) || Number(value.vehicles) < 1 || Number(value.vehicles) > MAX_VEHICLES)
    return `A frota deve conter de 1 a ${MAX_VEHICLES} veículos.`;
  return null;
}

export function assertInstanceSize(value: unknown): void {
  const error = instanceSizeError(value);
  if (error) throw new Error(error);
}
