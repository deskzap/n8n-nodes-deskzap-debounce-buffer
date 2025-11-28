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

export class DeskzapDebounceSmartBuffer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Deskzap - Smart Debounce Buffer',
		name: 'deskzapDebounceSmartBuffer',
		icon: 'file:DeskzapDebounceSmartBuffer.png',
		group: ['transform'],
		version: 1,
		description: 'Acumula mensagens e usa LLM para processar após silêncio (Debounce).',
		defaults: {
			name: 'Smart Buffer',
		},
		inputs: [
			'main',
			{
				displayName: 'Model',
				type: 'ai_languageModel',
				required: false,
				maxConnections: 1,
			},
		],
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
			{
				displayName: 'System Prompt',
				name: 'systemPrompt',
				type: 'string',
				default: 'Você é um editor de texto experiente. Sua tarefa é receber uma lista de mensagens de chat fragmentadas e transformá-las em um único texto coerente, corrigindo pontuação e gramática, mas mantendo o tom original. Não adicione informações extras, apenas organize o texto.',
				description: 'Instrução para o LLM sobre como processar as mensagens',
				typeOptions: {
					rows: 4,
				},
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
					const systemPrompt = this.getNodeParameter('systemPrompt', i) as string;
					
					const listKey = `deskzap:buffer:${sessionKey}`;
					
					// Generate a unique ID for this message execution to avoid content collision
					const messageId = Math.random().toString(36).substring(7);
					const payload = JSON.stringify({ text: message, id: messageId });

					// 1. Push message payload to Redis List
					await redis.rpush(listKey, payload);
					
					// 2. Wait for TTL (Debounce)
					await new Promise(resolve => setTimeout(resolve, ttl * 1000));

					// 3. Check if I am still the tail (last message)
					const lastPayloadString = await redis.lindex(listKey, -1);

					if (lastPayloadString) {
						const lastPayload = JSON.parse(lastPayloadString);
						
						if (lastPayload.id === messageId) {
							// I am the last one! No new messages arrived during wait.
							const allPayloads = await redis.lrange(listKey, 0, -1);
							const allMessages = allPayloads.map(p => JSON.parse(p).text);
							
							// Join messages with a space
							let finalOutput = allMessages.join(' ');

							// 4. Try to use LLM if connected
							try {
								// Check if model input is connected
								// Note: 'model' is the input name defined in description
								// We use generic type access because we don't have the langchain types imported
								const model = await this.getInputConnectionData('ai_languageModel', 0) as any;

								if (model) {
									// Call the model
									// Most n8n language models expose a method to predict or call
									// We construct a prompt combining system prompt and user messages
									
									// If the model supports 'call' or 'predict' (LangChain style)
									if (typeof model.call === 'function') {
										const response = await model.call(systemPrompt + '\n\nMessages:\n' + finalOutput);
										// Response might be an object or string depending on the model node
										finalOutput = typeof response === 'string' ? response : (response.text || response.content || finalOutput);
									} else if (typeof model.predict === 'function') {
										// Fallback for some older implementations
										finalOutput = await model.predict(systemPrompt + '\n\nMessages:\n' + finalOutput);
									}
								}
							} catch (llmError) {
								console.warn('Error calling LLM, falling back to raw text:', llmError);
								// Fallback to raw text is already set in finalOutput
							}

							// Clear Buffer
							await redis.del(listKey);

							return {
								json: {
									status: 'aggregated',
									sessionKey,
									messageCount: allMessages.length,
									messages: allMessages,
									text: finalOutput,
								},
							} as INodeExecutionData;
						}
					}
				} catch (error) {
					console.error(`Error processing item ${i}:`, error);
					return null;
				}
				return null;
			});

			const results = await Promise.all(promises);
			
			// Filter out nulls
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
