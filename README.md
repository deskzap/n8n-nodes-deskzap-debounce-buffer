# Deskzap - Debounce Time Buffer

Node customizado para n8n desenvolvido pela **Deskzap Automações**.

Este node permite acumular mensagens de chat (como WhatsApp ou Telegram) e processá-las em lote apenas após um período de silêncio (Debounce). Ele utiliza o Redis para armazenamento temporário.

## Funcionalidades

- **Buffer Inteligente (Debounce)**: Aguarda o usuário parar de digitar por X segundos antes de processar.
- **Armazenamento Rápido**: Usa Redis para garantir alta performance e persistência temporária.
- **Limpeza Automática**: Remove as mensagens do buffer após o processamento.  
- **Saída Estruturada**: Retorna JSON com texto unificado e array de mensagens.

## 📥 Instalação

### Via n8n Community Nodes (Recomendado)

1. Abra o n8n
2. Vá em `Settings` → `Community Nodes`
3. Clique em `Install`
4. Digite: `n8n-nodes-deskzap-buffer`
5. Instalar

### Via npm

```bash
cd ~/.n8n
npm install n8n-nodes-deskzap-buffer
```

## ⚠️ Importante

**O webhook DEVE estar em Modo de Produção!**

Para que o node funcione corretamente com múltiplas mensagens:

1. Abra o workflow no n8n
2. **Ative o workflow** (botão "Active" no topo)
3. O webhook automaticamente entrará em modo produção
4. Webhooks em modo de teste só permitem 1 execução por vez

## 🎯 Como Usar

1. Adicione o node **Deskzap - Debounce Time Buffer** ao seu workflow.
2. Configure as **Credenciais do Redis**.
3. Preencha os campos:
   - **Chave da Sessão**: O ID único do chat (ex: `{{$json.chatId}}`)
   - **Mensagem**: O texto da mensagem recebida (ex: `{{$json.text}}`)
   - **Tempo de Espera (Segundos)**: Quanto tempo esperar após a última mensagem (ex: `30`)

### Saída (Output)

Quando o debounce é acionado, o node retorna:

```json
{
  "status": "aggregated",
  "sessionKey": "12345",
  "messageCount": 5,
  "messages": ["Oi", "tudo bem?", "preciso", "de", "ajuda"],
  "text": "Oi tudo bem? preciso de ajuda"
}
```

Use o campo `text` para enviar ao LLM (ex: OpenAI, Basic LLM Chain, etc).

### Comportamento Esperado

- Quando uma mensagem chega, o node a salva e entra em modo de espera.
- Se novas mensagens chegarem durante a espera, o timer é resetado.
- Apenas a **última** mensagem retorna dados após o silêncio completo.
- Mensagens intermediárias não retornam output (comportamento normal do debounce).

## Suporte

Desenvolvido por **Deskzap Automações**.  
Contato: contato@deskzap.com.br
