export default class SwitchableStream extends TransformStream {
  private _controller: TransformStreamDefaultController | null = null;
  private _currentReader: ReadableStreamDefaultReader | null = null;
  private _switches = 0;
  private _isActive = false;

  constructor() {
    let controllerRef: TransformStreamDefaultController | undefined;

    super({
      start(controller) {
        controllerRef = controller;
      },
    });

    if (controllerRef === undefined) {
      throw new Error('Controller not properly initialized');
    }

    this._controller = controllerRef;
  }

  async switchSource(newStream: ReadableStream) {
    if (!newStream || typeof newStream.getReader !== 'function') {
      throw new Error('Invalid stream provided');
    }

    if (this._currentReader) {
      try {
        await this._currentReader.cancel();
      } catch (error) {
        console.warn('Error cancelling previous reader:', error);
      }
    }

    this._currentReader = newStream.getReader();
    this._isActive = true;
    
    try {
      await this._pumpStream();
    } catch (error) {
      console.error('Error in switchSource:', error);
      if (this._controller) {
        this._controller.error(error);
      }
    }

    this._switches++;
  }

  private async _pumpStream() {
    if (!this._currentReader || !this._controller) {
      throw new Error('Stream is not properly initialized');
    }

    try {
      while (this._isActive) {
        const { done, value } = await this._currentReader.read();

        if (done) {
          this._isActive = false;
          break;
        }

        if (value === undefined || value === null) {
          console.warn('Received undefined/null value from stream');
          continue;
        }

        try {
          await new Promise<void>((resolve, reject) => {
            try {
              this._controller?.enqueue(value);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        } catch (enqueueError) {
          console.error('Error enqueueing value:', enqueueError);
          throw enqueueError;
        }
      }
    } catch (error) {
      console.error('Error in stream processing:', error);
      throw error;
    } finally {
      if (this._currentReader) {
        try {
          await this._currentReader.cancel();
          this._currentReader = null;
        } catch (cancelError) {
          console.warn('Error cancelling reader:', cancelError);
        }
      }
      
      if (!this._controller?.desiredSize) {
        this._controller?.terminate();
      }
    }
  }

  close() {
    this._isActive = false;
    
    if (this._currentReader) {
      this._currentReader.cancel().catch(error => {
        console.warn('Error cancelling reader during close:', error);
      });
    }

    if (this._controller && !this._controller.desiredSize) {
      this._controller.terminate();
    }
  }

  get switches() {
    return this._switches;
  }

  get isActive() {
    return this._isActive;
  }
}
