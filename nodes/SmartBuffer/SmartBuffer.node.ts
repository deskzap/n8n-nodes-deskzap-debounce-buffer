import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import Redis from 'ioredis';

export class SmartBuffer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Deskzap - Smart Buffer',
		name: 'deskzapSmartBuffer',
		icon: 'file:SmartBuffer.png',
		group: ['transform'],
		version: 1,
		description: 'Acumula mensagens e usa IA para processar o contexto unificado.',
		defaults: {
			name: 'Smart Buffer',
		},
		// Input para conectar o modelo de linguagem (LLM)
		inputs: [
			'main',
			{
				displayName: 'AI Model',
				name: 'ai_languageModel',
				type: 'ai_languageModel',
				maxConnections: 1,
				required: true,
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
				typeOptions: {
					rows: 4,
				},
				default: 'Você é um assistente útil. Resuma as mensagens a seguir em um único texto coerente.',
				description: 'Instrução para a IA sobre como processar as mensagens acumuladas',
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
			const promises = items.map(async (item, i) => {
				try {
					const sessionKey = this.getNodeParameter('sessionKey', i) as string;
					const message = this.getNodeParameter('message', i) as string;
					const ttl = this.getNodeParameter('ttl', i) as number;
					const systemPrompt = this.getNodeParameter('systemPrompt', i) as string;
					
					const listKey = `deskzap:smartbuffer:${sessionKey}`;
					const messageId = Math.random().toString(36).substring(7);
					const payload = JSON.stringify({ text: message, id: messageId });

					// 1. Push message to Redis
					await redis.rpush(listKey, payload);
					
					// 2. Wait for TTL (Debounce)
					await new Promise(resolve => setTimeout(resolve, ttl * 1000));

					// 3. Check if I am the tail
					const lastPayloadString = await redis.lindex(listKey, -1);

					if (lastPayloadString) {
						const lastPayload = JSON.parse(lastPayloadString);
						
						if (lastPayload.id === messageId) {
							// Winner execution
							const allPayloads = await redis.lrange(listKey, 0, -1);
							const allMessages = allPayloads.map(p => JSON.parse(p).text);
							const joinedText = allMessages.join('\n');

							// Clear Buffer
							await redis.del(listKey);

							// 4. Call LLM
							let aiResponse = '';
							try {
								// Get the connected LLM model
								const model = await this.getInputConnectionData('ai_languageModel', i);
								
								// Prepare the prompt
								// Using invoke or predict depending on the model interface provided by n8n
								// n8n usually provides a LangChain model instance
								
								// We construct a simple prompt: System + User Messages
								// Note: The specific method to call depends on the LangChain version n8n uses.
								// .invoke() is standard in newer LangChain.
								
								// @ts-ignore
								if (model && typeof model.invoke === 'function') {
									// @ts-ignore
									const response = await model.invoke([
										{ role: 'system', content: systemPrompt },
										{ role: 'user', content: joinedText }
									]);
									// Handle response content (it might be an object or string)
									aiResponse = typeof response.content === 'string' ? response.content : JSON.stringify(response);
								} 
								// @ts-ignore
								else if (model && typeof model.call === 'function') {
									// Older LangChain
									// @ts-ignore
									aiResponse = await model.call(`${systemPrompt}\n\nMessages:\n${joinedText}`);
								} else {
									throw new Error('Model interface not recognized or no model connected.');
								}

							} catch (aiError) {
								console.error('AI Processing Error:', aiError);
								aiResponse = `Error processing with AI: ${(aiError as Error).message}. Raw text: ${joinedText}`;
							}

							return {
								json: {
									status: 'aggregated',
									sessionKey,
									messageCount: allMessages.length,
									originalMessages: allMessages,
									aiResponse,
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
