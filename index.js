"use strict";

var Promise = require('bluebird');
var slack = require('slack');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var RateLimiter = require('promise-queue-rate-limited');

var DEFAULT_TIMEOUT = 3000;

/* Create a rate limiter object that limits to 1 request per second, to avoid 429 errors */
var rateLimiter = new RateLimiter(1);
rateLimiter.start();

/* Return a rate-limited version of another function */
var rateLimit = function(fn) {
    return function() {
        var args = Array.prototype.slice.call(arguments);
        return rateLimiter.append(function() {
            return fn.apply(null, args);
        });
    };
};

/* Go through all properties in slack module and promisify and rate limit their methods. */
Object.keys(slack).forEach(function(api) {
    if (api === 'describe') {
        return;
    }
    slack[api] = Promise.promisifyAll(slack[api], { promisifer: function(fn) {
        rateLimit(Promise.promisify(fn));
    } });
});

/* Return true if first argument a, matches second argument b, according to rules:
   a nd b are objects, and:
       * properties in a are subset of properties in b,
       * if a value in a is a is an object, then the respective value is recursively matched with the same function,
   or a is a regular expression that matches string b,
   or a is strictly equal to b
 */
var isMatching = function(a, b) {
    if (typeof a === 'object' && !(a instanceof RegExp)) {
        for (var prop in a) {
            if (!(prop in b)) {
                return false;
            }
            if (!isMatching(a[prop], b[prop])) {
                return false;
            }
        }
        return true;
    }
    else if (a instanceof RegExp && typeof b === 'string') {
        return b.match(a); 
    }
    else {
        return a === b;
    }
};

/* Return channel id for sending direct messages to this user id. */
var getImChannelId = function(token, userId) {
    return slack.im.listAsync({token: token})
    .get('ims')
    .filter(function (channel) {
        return channel.user === userId;
    }).tap(function(channels) {
		if (channels.length === 0) {
			throw new Exception('No im channel found for user: ' + userId);
		}
	}).get(0).get('id');
};

/* Get channel id from channel name. */
var getChannelId = function(token, channelName) {
	return slack.channels.listAsync({token: token})
	.get('channels')
	.filter(function (channel) {
		return channel.name === channelName;
	}).tap(function(channels) {
		if (channels.length === 0) {
			throw new Exception('Could not find channel named: ' + channelName);
		}
	}).get(0).get('id');
};

/* Get group (private channel) id from group name. */
var getGroupId = function(token, groupName) {
	return slack.groups.listAsync({token: token})
	.get('groups')
	.filter(function (group) {
		return group.name === groupName;
	}).tap(function(groups) {
		if (groups.length === 0) {
			throw new Exception('Could not find group: ' + groupName);
		}
	}).get(0).get('id');
};

/* Get user id from user name. */
var getUserId = function(token, username) {
    return slack.users.listAsync({token: token})
    .get('members')
    .filter(function (member) {
        return member.name === username;
	}).tap(function(members) {
		if (members.length === 0) {
			throw new Exception('Could not find member with username: ' + username);
		}
	}).get(0).get('id');
};

/* Error class that signifies that the error was we didn't receive the message we expected. */
var WaitError = function(message, received) {
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.message = message;
    this.received = received;
}

util.inherits(WaitError, Error);

var makeListener = function(bot, filterObj, fnExpect, cb) {
    if (typeof filterObj !== 'object') {
        throw new TypeError('Invalid filterObj in makeListener');
    }
	return function(message) {
		if (message.user === bot.userId) {
			return;
		}
        if (!isMatching(filterObj, message)) {
            return;
        }
		if (typeof fnExpect === 'function') {
			Promise.method(fnExpect).bind(bot)(message)
            .asCallback(cb);
		}
		else {
			cb();
		}
	};
};

// TODO: improve how expectation is printed, currently only prints text attribute
var fail = function(bot, expectation) {
	var received = bot.messages.map(function(message) { return message.text; });
    var msg;
    if (expectation.text) {
        msg = 'Expected message "' + expectation.text.toString() + '" was not received.';
    }
    else {
        msg = 'Expected message was not received.';
    }
	if (received.length > 0) {
		msg += ' Instead, received following messages:\n' + JSON.stringify(received);
	}
	else {
		msg += ' Did not receive any messages at all.';
	}
	throw new WaitError(msg, received);
};

var waitFor = function(bot, filterObj, fnExpect) {
    if (typeof filterObj !== 'object') {
        throw new TypeError('Invalid filterObj in waitFor');
    }
    var self = this;
	var listener;
	return Promise.fromCallback(function(cb) {
		listener = makeListener(bot, filterObj, fnExpect, cb);
		bot.addListener('message', listener);
		// replay messages received already, in case we were late to the party
		bot.messages.forEach(function(message) {
			listener(message);
		});
	}).timeout(bot.timeout)
	.catch(function(e) {
        // if we failed due to timeout, create a special error message
		if (e instanceof Promise.TimeoutError) {
			fail(bot, filterObj);
		}
        else {
            throw e;
        }
	}).finally(function() {
        if (typeof listener === 'function') {
            bot.removeListener('message', listener);
        }
	});
};

/* Change bot channel id, so that next messages are sent as direct message to this user. */
var im = function(bot, username) {
    return getUserId(bot.token, username)
    .then(function (userId) {
        return getImChannelId(bot.token, userId);
    }).then(function (channelId) {
        bot.channelId = channelId;
    });
};

/* Send a message on the current channel. */
var send = function(bot, text) {
    if (typeof bot.channelId === 'undefined') {
        throw new Error('Please select channel first with im, channel or group methods.');
    }
    return slack.chat.postMessageAsync({
        token: bot.token,
        text: text,
        channel: bot.channelId,
        as_user: true
    });
};

var expect = function(bot, text, opts, fnExpect) {
    if (!bot.channelId) {
        throw new Error('Please select channel first with im, channel or group methods.');
    }
    var filterObj = {
        channel: bot.channelId
    };
    // expect (text, [obj], [fn])
    if ((typeof text === 'string' || text instanceof RegExp) && (typeof opts === 'object' || typeof opts === 'undefined') && (typeof fnExpect === 'function' || typeof fnExpect === 'undefined')) {
        filterObj.type = 'message';
        filterObj.text = text;
    }
    // expect(text, fn)
	else if ((typeof text === 'string' || text instanceof RegExp) && typeof opts === 'function' && typeof fnExpect === 'undefined') {
        filterObj.type = 'message';
        filterObj.text = text;
		fnExpect = opts;
	}
    // expect(fn)
    else if (typeof text === 'function' && typeof opts === 'undefined' && typeof fnExpect === 'undefined') {
        fnExpect = text;
    }
    // expect(obj, [fn])
    else if (typeof text === 'object' && !(text instanceof RegExp) && (typeof opts === 'function' || typeof opts === 'undefined')) {
        fnExpect = opts;
        opts = text;
    }
    else {
        throw new TypeError('Wrong type of arguments passed to expect: ' + (typeof text) + ', ' + (typeof opts) + ', ' + (typeof fnExpect));
    }
    if (typeof opts !== 'undefined') {
        Object.keys(opts).forEach(function(prop) {
            filterObj[prop] = opts[prop];
        });
    }
    return waitFor(bot, filterObj, fnExpect);
};

/* Succeeds if any of texts or filter objects succeed.
   The same callback function is used for all cases to avoid complexity. */
var expectAny = function(bot, texts, fnExpect) {
    return Promise.any(texts.map(function (text) {
        var opts = {};
        if (typeof text === 'string' || text instanceof RegExp) {
            opts.text = text;
            opts.type = 'message';
        }
        else if (typeof text === 'object') {
            opts = text;
        }
        else {
            throw new TypeError('Unexpected array element in expectOneOf: ' + JSON.stringify(text));
        }
        return waitFor(bot, opts, fnExpect);
    })).catch(function (e) {
        // throw again any error other than aggregate (result of Promise.any failing all of them)
        if (!(e instanceof Promise.AggregateError)) {
            throw e;
        }
        e.forEach(function(err) {
            // if any promise failed with error other than "WaitError", throw it
            if (!(err instanceof WaitError)) {
                throw err;
            }
        });
        // now we know that all promises failed with wait error, create a nice message
        var msg = 'Expected messages "' + JSON.stringify(texts) + '" were not received.';
        if (e[0].received.length > 0) {
            msg += ' Instead, received the following messages:\n' + JSON.stringify(e[0].received);
        }
        else {
            msg += ' Did not receive any messages at all.';
        }
        throw new Error(msg);
    });
}

/* Change channel to the given channel name, all future messages will be send and received from that channel. */
var channel = function(bot, channelName) {
	return getChannelId(bot.token, channelName)
	.then(function(channelId) {
		bot.channelId = channelId;	
	});
}

/* Change channel to the given group (private channel) name, all future messages will be send and received from that group. */
var group = function(bot, groupName) {
	return getGroupId(bot.token, groupName)
	.then(function(channelId) {
		bot.channelId = channelId;
	});
}

/* Connect to rtm and authenticate user. */
var start = function(bot) {
    var rtm = slack.rtm.client();
    rtm.message(function(message) {
		bot.messages.push(message);
        bot.emit('message', message);
    });
	bot.rtm = rtm;
    rateLimiter.append(function() {
        return rtm.listen({token: bot.token});
    });
	return slack.auth.testAsync({token: bot.token})
	.get('user_id')
	.then(function(userId) {
		bot.userId = userId;
	});
};

var testoBot = function(opts) {
    var bot = new EventEmitter();
    bot.token = opts.token;
    bot.timeout = opts.timeout || DEFAULT_TIMEOUT;
	bot.messages = [];
    bot.fail = fail.bind(bot, bot);
    return promiseChain(bot, {start: start, im: im, send: send, expect: expect, expectAny: expectAny, channel: channel, group: group }).start();
}

/* Wrap a function so that it is applied to the promise of its currently bound object. */
var promiseWrap = function(f) {
    return function() {
        var self = this;
        var args = Array.prototype.slice.call(arguments);
        args.unshift(this);
        this.promise = this.promise.then(function() {
            return f.apply(self, args);
        });
        return this;
   };
};

var promiseChain = function(obj, funcs) {
    obj.promise = Promise.resolve(true);
    for (var i in funcs) {
        if (funcs.hasOwnProperty(i)) {
            obj[i] = promiseWrap(funcs[i]);
        }
    }
    obj.end = function(cb) {
		var p = this.promise.asCallback(cb);
		var self = this;
        this.promise = this.promise.catch(function(){}).finally(function() {
			self.messages = [];
		});
		return p;
    };
    return obj;
}

module.exports = exports = testoBot;
