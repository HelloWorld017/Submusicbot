const bodyParser = require('body-parser');
const cheerio = require('cheerio');
const download = require('download');
const express = require('express');
const http = require('http');
const logger = require('morgan');
const rq = require('request-promise').defaults({
	'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.143 Safari/537.36'
});

const {Html5Entities} = require('html-entities');
const entities = new Html5Entities();

const telegram = require('telegram-bot-api');

const config = require('./config/');

const _baseurl = 'https://api.telegram.org/bot' + config.token + '/';
const useCert = (process.env.CERT === 'true');
const useHook = (process.env.HOOK === 'true');

global.debug = (process.env.NODE_ENV || 'development') === 'development';

const handleHook = (update) => {
	if(update.callback_query) return handleCallback(update.callback_query);
	if(!update.message) return;
	if(update.message.text){
		update.message.text = update.message.text.slice(0, 128);
		if(update.message.text.startsWith('bs:')){
			let query = update.message.text.replace('bs:', '');
			rq({
				method: 'GET',
				uri: `http://bgmstore.net/search?q_type=title&q_mode=general&q=${query}`
			}).then((body) => {
				const $ = cheerio.load(body);
				const result = $('.searchResultWrap .title');
				const buttons = [];
				for(let i = 0; i < result.length; i++){
					let v = $(result[i]);

					let match = v.attr('href').match(/view\/([a-zA-Z0-9]+)/);
					if(match === null) continue;
					if(match[1] === undefined) continue;
					buttons.push([{
						callback_data: 'bs:' + match[1],
						text: entities.decode(v.html())
					}]);
				}
				return rq({
					method: 'POST',
					form: {
						chat_id: update.message.chat.id,
						text: '보내실 노래를 선택해주세요!',
						reply_markup: JSON.stringify({
							inline_keyboard: buttons.slice(0, 20)
						})
					},
					url: _baseurl + 'sendMessage'
				});
			}).catch((err) => {
				console.error(err);
				api.sendMessage({
					chat_id: update.message.chat.id,
					text: '죄송합니다! 오류가 생겼습니다!'
				});
			});
		}else if(update.message.text.startsWith('op:')){
			let query = update.message.text.replace('op:', '');
			rq({
				method: 'GET',
				uri: `http://bgm.khinenw.tk/search?q=${query}`,
				json: true
			}).then((data) => {
				if(typeof data === 'string') data = JSON.parse(data);
				return rq({
	                method: 'POST',
	                form: {
						chat_id: update.message.chat.id,
						text: '보내실 노래를 선택해주세요!',
						reply_markup: JSON.stringify({
							inline_keyboard: data.map((v) => {
								return [{
									callback_data: 'op:' + v.id,
									text: v.artist + ' - ' + v.title
								}];
							}).slice(0, 20)
						})
					},
	                url: _baseurl + 'sendMessage'
	            });
			}).catch((err) => {
				console.error(err);
				api.sendMessage({
					chat_id: update.message.chat.id,
					text: '죄송합니다! 오류가 생겼습니다!'
				});
			});
		}
	}else if(update.message.audio){
		api.forwardMessage({
			chat_id: config.target,
			from_chat_id: update.message.chat.id,
			message_id: update.message.message_id
		});
	}
};

const handleCallback = (cq) => {
	if(typeof cq.data !== 'string') return;
	api.answerCallbackQuery({
		callback_query_id: cq.inline_message_id
	});
	console.log(cq.data);
	if(cq.data.startsWith('bs:')){
		let data = cq.data.replace('bs:', '');

		rq({
			method: 'POST',
			json: true,
			formData: {
				chat_id: config.target,
				audio: download(`https://dl.bgms.kr/download/${data}/mp3/musik`)
			},
			uri: _baseurl + 'sendAudio'
		});
	}else if(cq.data.startsWith('op:')){
		let data = cq.data.replace('op:', '');

		rq({
			method: 'GET',
			uri: `https://bgm.khinenw.tk/load/${data}`,
			json: true
		}).catch((err) => {
			return rq({
				method: 'GET',
				uri: `https://bgm.khinenw.tk/load/${data}`,
				json: true
			});
		}).then((data) => {
			rq({
				method: 'POST',
				json: true,
				formData: {
					chat_id: config.target,
					audio: download(`https://bgm.khinenw.tk/${data.audio}`)
				},
				uri: _baseurl + 'sendAudio'
			});
		}).catch((err) => {
			console.error(err);
		});
	}
}

global.api = new telegram({
	token: config.token,
	updates: {
		enabled: !useHook
	}
});

if(useHook){
	const app = express();
	if(debug) app.use(logger('dev'));
	app.use(bodyParser.text({
		type: 'application/json'
	}));

	app.post('/' + hook, (req, res, next) => {
		const item = JSON.parse(req.body);
		handleHook(item);
		res.end(':D');
	});

	app.use((req, res, next) => {
		res.redirect('https://telegram.me/Submusicbot');
	});

	let httpServer;
	let options;

	if(useCert){
		options = {
			key: fs.readFileSync('/cert/key.pem'),
			crt: fs.readFileSync('/cert/crt.pem')
		};
	}

	const port = ((val) => {
		let portNumber = parseInt(val, 10);

		if(isNaN(portNumber)){
			return val;
		}

		if(portNumber >= 0){
			return portNumber;
		}

		return false;
	})(process.env.PORT || '443');

	app.set('port', port);

	if(useCert) httpServer = http.createServer(options, app);
	else httpServer = http.createServer(app);

	httpServer.listen(port);
	httpServer.on('error', (err) => {
		if(err.syscall !== 'listen') throw err;
		let bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;

		switch(err.code){
			case 'EACCES':
				console.error('Permission Denied!');
				process.exit(1);
				return;

			case 'EADDRINUSE':
				console.error('Address in use!');
				process.exit(1);
				return;
		}

		throw error;
	});

	httpServer.on('listening', () => {
		let addr = httpServer.address();
		console.log((typeof addr === 'string') ? 'Pipe ' + addr : 'Listening on port ' + addr.port);
	});

	if(!useCert){
		rq({
			method: 'POST',
			json: true,
			formData: {
				url: config.hookUrl + hook
			},
			url: _baseurl + 'setWebhook'
		});
	}else api.setWebhook(config.hookUrl + hook, options.crt);
}else{
	api.on('update', handleHook)
}
