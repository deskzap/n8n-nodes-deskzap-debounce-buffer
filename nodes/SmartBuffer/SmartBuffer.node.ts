import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

export class SmartBuffer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Deskzap - Smart Buffer',
		name: 'deskzapSmartBuffer',
		icon: 'file:SmartBuffer.png',
		group: ['transform'],
		version: 1,
		description: 'Debug Version - Hello World',
		defaults: {
			name: 'Smart Buffer',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				default: 'Hello World',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			returnData.push({
				json: {
					message: 'Hello World from Deskzap Smart Buffer (Debug)',
				},
			});
		}

		return [returnData];
	}
}

