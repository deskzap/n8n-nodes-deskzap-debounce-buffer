import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import Redis from 'ioredis';

/**
 * Deskzap Debounce Time Buffer Node
 * 
 * ⚠️ IMPORTANTE: Este node DEVE ser usado com workflow ATIVO (Production Mode)
 * 
 * Motivo:
 * - O node usa await setTimeout() para implementar o debounce (espera até usuário parar de digitar)
 * - Webhooks em MODO DE TESTE permitem apenas 1 execução por vez
 * - Se o webhook estiver em teste, novas mensagens serão BLOQUEADAS durante o tempo de espera
 * - Em MODO DE PRODUÇÃO (workflow ativo), o webhook aceita execuções paralelas ilimitadas
 * 
 * Como ativar o modo de produção:
 * 1. Clique no botão "Active" no topo do workflow
 * 2. O webhook automaticamente entrará em modo de produção
 * 3. Todas as mensagens serão processadas corretamente
 * 
 * Comportamento esperado:
 * - Cada mensagem cria uma execução independente
 * - Todas as execuções adicionam suas mensagens ao Redis
 * - Apenas a ÚLTIMA execução (após o silêncio) retorna os dados agregados
 * - Execuções anteriores terminam silenciosamente (comportamento normal do debounce)
 */

export class DeskzapDebounceBuffer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Deskzap - Debounce Time Buffer',
		name: 'deskzapDebounceBuffer',
		icon: 'file:DeskzapDebounceBuffer.png',
		group: ['transform'],
		version: 1,
		description: 'Acumula mensagens e processa apenas após tempo de silêncio (Debounce).',
		defaults: {
			name: 'Deskzap Buffer',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'redisCredentials',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Chave da Sessão',
				name: 'sessionKey',
				type: 'string',
				default: '',
				required: true,
				description: 'Identificador único da sessão (ex: ID do Chat ou Telefone)',
			},
			{
				displayName: 'Mensagem',
				name: 'message',
				type: 'string',
				default: '',
				required: true,
				description: 'Texto da mensagem a ser acumulada',
			},
			{
				displayName: 'Tempo de Espera (Segundos)',
				name: 'ttl',
				type: 'number',
				default: 30,
				required: true,
				description: 'Tempo de silêncio necessário para disparar o processamento',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		
		// Get Credentials
		const credentials = await this.getCredentials('redisCredentials');
		
		const redis = new Redis({
			host: credentials.host as string,
			port: credentials.port as number,
			password: credentials.password as string,
			db: credentials.db as number,
			tls: credentials.ssl ? {} : undefined,
		});

		try {
			// Use Promise.all to process items in parallel (non-blocking wait)
			const promises = items.map(async (item, i) => {
				try {
					const sessionKey = this.getNodeParameter('sessionKey', i) as string;
					const message = this.getNodeParameter('message', i) as string;
					const ttl = this.getNodeParameter('ttl', i) as number;
					
					const listKey = `deskzap:buffer:${sessionKey}`;
					
					// Generate a unique ID for this message execution to avoid content collision
					const messageId = Math.random().toString(36).substring(7);
					const payload = JSON.stringify({ text: message, id: messageId });

					// 1. Push message payload to Redis List
					// IMPORTANTE: Múltiplas execuções podem adicionar ao Redis simultaneamente (modo produção)
					await redis.rpush(listKey, payload);
					
					// 2. Wait for TTL (Debounce)
					// ATENÇÃO: Este wait NÃO bloqueia o webhook!
					// Cada execução espera de forma independente em paralelo.
					// Por isso é OBRIGATÓRIO que o workflow esteja ATIVO (production mode).
					await new Promise(resolve => setTimeout(resolve, ttl * 1000));

					// 3. Check if I am still the tail (last message)
					// Após o wait, verificamos se ESTA execução ainda é a última mensagem da lista.
					// Se uma nova mensagem chegou durante o wait, outra execução é a última.
					const lastPayloadString = await redis.lindex(listKey, -1);

					if (lastPayloadString) {
						const lastPayload = JSON.parse(lastPayloadString);
						
						if (lastPayload.id === messageId) {
							// I am the last one! No new messages arrived during wait.
							// Esta é a execução vencedora - processa e retorna tudo.
							const allPayloads = await redis.lrange(listKey, 0, -1);
							const allMessages = allPayloads.map(p => JSON.parse(p).text);
							
							// Join messages with a space
							const joinedText = allMessages.join(' ');

							// Clear Buffer
							await redis.del(listKey);

							return {
								json: {
									status: 'aggregated',
									sessionKey,
									messageCount: allMessages.length,
									messages: allMessages,
									text: joinedText,
								},
							} as INodeExecutionData;
						}
						// Se não sou a última, simplesmente retorno null.
						// Esta execução foi "interrompida" por uma mensagem mais recente.
						// Comportamento esperado do debounce.
					}
				} catch (error) {
					// Log error but don't crash other items
					console.error(`Error processing item ${i}:`, error);
					return null;
				}
				return null;
			});

			const results = await Promise.all(promises);
			
			// Filter out nulls (ignored items or errors)
			results.forEach(result => {
				if (result) {
					returnData.push(result);
				}
			});

		} catch (error) {
			if (redis) redis.disconnect();
			throw new NodeOperationError(this.getNode(), error as Error);
		}

		redis.disconnect();
		return [returnData];
	}
}
