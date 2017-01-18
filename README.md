# TestoBot

TestoBot allows you to test your slack chatbot with expect-style tests.

Should be compatible with most nodejs testing frameworks, such as [mocha](https://mochajs.org).

We are currently using it at [geekbot.io](https://geekbot.io) for end to end tests.

Inspired by [expect tests](https://en.wikipedia.org/wiki/Expect) and [supertest module](https://www.npmjs.com/package/supertest).

## Installation

You can install it through npm - we recommend installing it as a development dependency, since it will most probably only be used for testing.

    $ npm install --save-dev testobot

## Example

Here's a complete example using [mocha](https://mochajs.org) if one wanted to test "help" and setting reminders with slackbot.

Require testobot library and any other libraries you may need for your tests.

```javascript
var TestoBot = require('testobot');
var assert = require('assert');
```

Initialize TestoBot by passing a user access token. The example here receives the token from SLACK_TOKEN environment variable. You can get a testing token from [Slack API documentation](https://api.slack.com/docs/oauth-test-tokens).

```javascript
var bot = TestoBot({ token: process.env.SLACK_TOKEN });
```

We are using [mocha](https://mochajs.org) in these examples that has notation with `describe` and `it` blocks. The timeout is increased to 10 seconds, because Slack API requests are rate limited to 1 per second.

```javascript
describe('slackbot', function() {
    this.timeout(10000);
```

TestoBot can be used by chaining multiple methods. The `im` method sets the channel to receive and send messages to the direct message channel with the selected user, slackbot. You can also switch to a `channel` or `group` (private channel) using the respective methods. `send` sends a message to the channel, and `expect` tests that you receive the expected message.

```javascript
    it('responds to "help"', function() {
        return bot
        .im('slackbot')
        .send('help')
        .expect("I can help by answering simple questions about how Slack works. I'm just a bot, though! If you need more help, try our <https://get.slack.help/hc/en-us/|Help Center> for loads of useful information about Slack — it's easy to search! Or simply type */feedback* followed by your question or comment, and a human person will get back to you. :smile: ")
        .end();
    });
```

You can also use regular expressions instead of text, an object to further filter messages (the object properties will be compared with the slack RTM message received), and a callback function for writing custom assertions on the message received.

```javascript
    it('can setup reminders', function() {
        return bot
        .im('slackbot')
        .send('remind try testobot in 1 hour')
        .expect(/^:thumbsup: I will remind you “try testobot” in 1 hour at [0-9]{1,2}:[0-9]{1,2}(pm|am)/, {user: 'USLACKBOT'}, function(message) {
            assert(message.type, 'text');
            assert(message.user, 'USLACKBOT');
        }).end();
    });
});
```

## Notes

* **Timeouts**: Most testing frameworks set a timeout of a few seconds for each test. You will probably need to increase that timeout, since slack rate limits requests to 1 request per second, and the library conforms to this limit. This also  makes tests somewhat slow.
* **Slash commands**: TestoBot does NOT directly support slash commands, as there is no way to send them through the Slack API. You can test slash commands by combining TestoBot with an http request library that hits your webhook URL.
* **end()**: Do not forget to call the end method at the end of your testcase, and to **return** the result of the chain. Otherwise, your testing framework will probably just ignore the testcase and go to the next one.


## API

#### TestoBot({ token, [timeout] })

Initiate TestoBot with the current *token*. 

*timeout* specifies the time that TestoBot will wait to receive the expected messages before marking the test as failed.

#### TestoBot.im(username)

Switch "current" channel to the direct messaging channel with user *username*. Any messages will be sent and received from this channel.

#### TestoBot.channel(name)

Switch "current" channel to the channel with name *name*. Any messages will be sent and received from this channel.

#### TestoBot.group(name)

Switch "current" channel to the private channel with name *name*. Any messages will be sent and received from this channel.

#### TestoBot.send(text)

Send a text message to the current active channel set with `im`, `channel` or `group`. TestoBot will throw an exception if you use this command before setting a channel.

#### TestoBot.expect(textOrRegex, [filterObject], [cb])

Expect to receive a text message in the channel that is strictly equal to the *text* in the first parameter, or in case it is a regular expression, expect that the text will match it.

*filterObject* will be matched against the message received from RTM. Every property in filterObject must exist in the message. The properties can be:
   * A string, that will be strictly compared with the respective field in the RTM message,
   * A regular expression, that will be tested against the respective field in the RTM message,
   * Or an object, that will be recursively compared in the same way.

This means that you can compare fields in the RTM message such as user, type, or attachments, and even the attachment text can be tested with a regular expression!

The `cb` argument will be passed the message that matched the previous arguments for running custom test logic. The function can call `this.fail` method to signal that this wasn't the expected message, in order to wait for more messages.

#### TestoBot.expect(filterObject, [cb])

Same as the above method, except the RTM event received may not be of type "message". For example, this can be used to wait for a "user typing" event.

#### TestoBot.expect(cb)

Do not filter any messages, just run custom test logic on the messages. The function must use `TestoBot.fail` to signal that a message was not the intended one, to receive more messages.

#### TestoBot.expectAny(textRegexOrFilterArray, [cb])

Wait until any of the elements in the array, match a message received. If the array contains a text or regex, it is used in the same way as `TestoBot.expect(textOrRegex, filterObject, cb)`, otherwise it is treated as the first parameter in `TestoBot.expect(filterObject, cb)`.

#### TestoBot.end([done])

Ends the chain of interactions for this test, and returns a promise. If the testing framework does not support promises, the callback for this testcase can be registered as a callback. The first argument to the callback will be an error object, if the test failed, otherwise null.

#### TestoBot.fail([expectation])

Used by callback functions to mark that the currently received message was not the one expected, and to wait for more messages. 

The optional *expectation* argument is an object similar to `filterObject` in `TestoBot.expect`, and is used for prettier error messages.


## Contributing

1. Fork it!
2. Create your feature branch: `git checkout -b my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin my-new-feature`
5. Submit a pull request :D

For ideas, bugs, or feature requests, submit an issue on our github page.

## History

* **January 17, 2017**: Released initial version.


## License

Copyright 2017 Alexios Brezas

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
