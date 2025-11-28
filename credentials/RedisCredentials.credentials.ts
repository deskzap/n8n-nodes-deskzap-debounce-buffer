import {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class RedisCredentials implements ICredentialType {
	name = 'redisCredentials';
	displayName = 'Redis Credentials';
	documentationUrl = 'https://redis.io/';
	properties: INodeProperties[] = [
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: 'localhost',
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 6379,
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
		},
		{
			displayName: 'Database',
			name: 'db',
			type: 'number',
			default: 0,
		},
		{
			displayName: 'SSL',
			name: 'ssl',
			type: 'boolean',
			default: false,
		},
	];
}
