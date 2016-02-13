'use strict';

const path = require('path');

const test = require('prova');
const proxyquire = require('proxyquire').noPreserveCache().noCallThru();
const devnull = require('dev-null');
const qs = require('q-stream');

const dummyConfig = { inputStream: devnull(), outputStream: devnull() };
const dummyCp = { spawnSync: () => { return { status: 0 }; } };
const dummyBudo = { on: () => {} };


test('Prints `--help`', (assert) => {
  assert.plan(3);

  const child = { spawnSync: (command, args) => {
    assert.equal(command, 'man',
      'spawns `man`'
    );

    assert.equal(
      args[0],
      path.resolve(__dirname, 'manpages/elm-live.1'),
      'with the right manpage'
    );
  } };

  const elmLive = proxyquire('./source/elm-live', { 'child_process': child });

  const exitCode = elmLive(['--help'], dummyConfig);

  assert.equal(exitCode, 0,
    'succeeds'
  );
});


test('Shouts if `elm-make` can’t be found', (assert) => {
  assert.plan(3);

  const expectedMessage = new RegExp(
`^elm-live:
  I can’t find the command \`elm-make\`!`
  );

  const child = { spawnSync: (command) => {
    assert.equal(command, 'elm-make',
      'spawns `elm-make`'
    );

    return { error: { code: 'ENOENT' } };
  } };

  const elmLive = proxyquire('./source/elm-live', { 'child_process': child });

  const exitCode = elmLive([], { outputStream: qs((chunk) => {
    assert.ok(
      expectedMessage.test(chunk),
      'prints an informative message'
    );
  }), inputStream: devnull() });

  assert.equal(exitCode, 1,
    'fails'
  );
});


test('Prints any other `elm-make` error', (assert) => {
  assert.plan(3);

  const message = 'whatever';
  const status = 9;

  const child = { spawnSync: (command) => {
    assert.equal(command, 'elm-make',
      'spawns `elm-make`'
    );

    return { status, error: { toString: () => message } };
  } };

  const elmLive = proxyquire('./source/elm-live', { 'child_process': child });

  const exitCode = elmLive([], { outputStream: qs((chunk) => {
    assert.equal(
      chunk,
      (
`elm-live: Error while calling \`elm-make\`! This output may be helpful:
  ${ message }

`
      ),
      'prints the error’s output'
    );
  }), inputStream: devnull() });

  assert.equal(exitCode, status,
    'exits with whatever code `elm-make` returned'
  );
});


test('Passes correct args to `elm-make`', (assert) => {
  assert.plan(2);

  const elmLiveArgs = ['--port=77'];
  const otherArgs =
    ['--anything', 'whatever', 'whatever 2', '--beep=boop', '--no-flag'];

  const child = { spawnSync: (command, args) => {
    assert.equal(command, 'elm-make',
      'spawns `elm-make`'
    );

    assert.deepEqual(
      args,
      otherArgs,
      'passes all not understood arguments'
    );

    // Kill after one attempt
    return { status: 77, error: {} };
  } };

  const elmLive = proxyquire('./source/elm-live', { 'child_process': child });
  elmLive(elmLiveArgs.concat(otherArgs), dummyConfig);
});


test('Disambiguates `elm-make` args with `--`', (assert) => {
  assert.plan(2);

  const elmMakeBefore =
    ['--anything', 'whatever', 'whatever 2'];
  const elmLiveBefore =
    ['--open'];
  const elmMakeAfter =
    ['--port=77', '--beep=boop'];
  const allArgs = [].concat(
    elmMakeBefore,
    elmLiveBefore,
    ['--'],
    elmMakeAfter
  );

  const child = { spawnSync: (command, args) => {
    assert.equal(command, 'elm-make',
      'spawns `elm-make`'
    );

    assert.deepEqual(
      args,
      elmMakeBefore.concat(elmMakeAfter),
      'passes all not understood commands and all commands after the `--` ' +
      'to elm-make'
    );

    // Kill after one attempt
    return { status: 77, error: {} };
  } };

  const elmLive = proxyquire('./source/elm-live', { 'child_process': child });
  elmLive(allArgs, dummyConfig);
});


test('Redirects elm-make stdio', (assert) => {
  assert.plan(4);

  const elmLiveOut = (
`Hello there!
How’s it going?
`
  );
  const elmLiveErr = (
`Not too well, to be honest
`
  );

  const inputStream = {};

  const child = { spawnSync: (command, _, options) => {
    assert.equal(command, 'elm-make',
      'spawns `elm-make`'
    );

    assert.equal(
      options.stdio[0],
      inputStream,
      'takes stdin from the `inputStream`'
    );

    options.stdio[1].write(elmLiveOut);
    options.stdio[2].write(elmLiveErr);

    return {};
  } };

  let run = 0;
  const elmLive = proxyquire('./source/elm-live', { 'child_process': child });
  elmLive([], { inputStream, outputStream: qs((chunk) => {
    if (run === 0) assert.equal(
      chunk,
      elmLiveOut,
      'directs stdout to the `outputStream`'
    );

    if (run === 1) assert.equal(
      chunk,
      elmLiveErr,
      'directs stderr to the `outputStream`'
    );

    run++;
  }) });
});


test('Starts budo and gaze with correct config', (assert) => {
  assert.plan(5);

  const budo = (options) => {
    assert.equal(options.port, 8000,
      'uses port 8000 by default (or the next available one)'
    );

    assert.equal(options.open, false,
      'doesn’t `--open` the app by default'
    );

    assert.equal(options.watchGlob, '**/*.{html,css,js}',
      'reloads the app when an HTML, JS or CSS static file changes'
    );

    assert.equal(options.stream, dummyConfig.outputStream,
      'directs all output to `outputStream`'
    );

    return dummyBudo;
  };

  const gaze = (glob) => {
    assert.equal(glob, '**/*.elm',
      'watches all `*.elm` files in the current directory ' +
      'and its subdirectories'
    );
  };

  const elmLive = proxyquire('./source/elm-live', {
    budo, gaze, 'child_process': dummyCp,
  });

  elmLive([], dummyConfig);
});


test('`--open`s the default browser', (assert) => {
  assert.plan(1);

  const budo = (options) => {
    assert.equal(options.open, true,
      'passes `--open` to budo'
    );

    return dummyBudo;
  };

  const gaze = () => {};

  const elmLive = proxyquire('./source/elm-live', {
    budo, gaze, 'child_process': dummyCp,
  });

  elmLive(['--open'], dummyConfig);
});


test('Serves at the specified `--port`', (assert) => {
  assert.plan(1);

  const portNumber = 867;

  const budo = (options) => {
    assert.equal(options.port, portNumber,
      'passes `--port` to budo'
    );

    return dummyBudo;
  };

  const gaze = () => {};

  const elmLive = proxyquire('./source/elm-live', {
    budo, gaze, 'child_process': dummyCp,
  });

  elmLive([`--port=${ portNumber }`], dummyConfig);
});