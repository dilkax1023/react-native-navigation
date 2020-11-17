import clone from 'lodash/clone';
import isEqual from 'lodash/isEqual';
import isObject from 'lodash/isObject';
import isArray from 'lodash/isArray';
import isString from 'lodash/isString';
import endsWith from 'lodash/endsWith';
import forEach from 'lodash/forEach';
import has from 'lodash/has';

import { Store } from '../components/Store';
import { UniqueIdProvider } from '../adapters/UniqueIdProvider';
import { ColorService } from '../adapters/ColorService';
import { AssetService } from '../adapters/AssetResolver';
import {
  AnimationOptions,
  Options,
  OptionsSearchBar,
  OptionsTopBar,
  StackAnimationOptions,
  ViewAnimationOptions,
} from '../interfaces/Options';
import { Deprecations } from './Deprecations';
import { OptionProcessorsStore } from '../processors/OptionProcessorsStore';
import { CommandName } from '../interfaces/CommandName';

export class OptionsProcessor {
  constructor(
    private store: Store,
    private uniqueIdProvider: UniqueIdProvider,
    private optionProcessorsRegistry: OptionProcessorsStore,
    private colorService: ColorService,
    private assetService: AssetService,
    private deprecations: Deprecations
  ) {}

  public processOptions(options: Options, commandName: CommandName) {
    this.processObject(
      options,
      clone(options),
      (key, parentOptions) => {
        this.deprecations.onProcessOptions(key, parentOptions, commandName);
        this.deprecations.checkForDeprecatedOptions(parentOptions);
      },
      commandName
    );
  }

  public processDefaultOptions(options: Options, commandName: CommandName) {
    this.processObject(
      options,
      clone(options),
      (key, parentOptions) => {
        this.deprecations.onProcessDefaultOptions(key, parentOptions);
      },
      commandName
    );
  }

  private processObject(
    objectToProcess: Record<string, any>,
    parentOptions: object,
    onProcess: (key: string, parentOptions: object) => void,
    commandName: CommandName,
    parentPath?: string
  ) {
    forEach(objectToProcess, (value, key) => {
      const objectPath = this.resolveObjectPath(key, parentPath);
      this.processWithRegisteredProcessor(key, value, objectToProcess, objectPath, commandName);
      this.processColor(key, value, objectToProcess);

      if (!value) {
        return;
      }

      this.processComponent(key, value, objectToProcess);
      this.processImage(key, value, objectToProcess);
      this.processButtonsPassProps(key, value);
      this.processSearchBar(key, value, objectToProcess);
      this.processInterpolation(key, value, objectToProcess);
      this.processAnimation(key, value, objectToProcess);

      onProcess(key, parentOptions);

      const processedValue = objectToProcess[key];
      if (!isEqual(key, 'passProps') && (isObject(processedValue) || isArray(processedValue))) {
        this.processObject(processedValue, parentOptions, onProcess, commandName, objectPath);
      }
    });
  }

  private resolveObjectPath(key: string, path?: string): string {
    if (!path) path = key;
    else path += `.${key}`;
    return path;
  }

  private processColor(key: string, value: any, options: Record<string, any>) {
    if (isEqual(key, 'color') || endsWith(key, 'Color')) {
      options[key] = value === null ? 'NoColor' : this.colorService.toNativeColor(value);
    }
  }

  private processWithRegisteredProcessor(
    key: string,
    value: string,
    options: Record<string, any>,
    path: string,
    commandName: CommandName
  ) {
    const registeredProcessors = this.optionProcessorsRegistry.getProcessors(path);
    if (registeredProcessors) {
      registeredProcessors.forEach((processor) => {
        options[key] = processor(value, commandName);
      });
    }
  }

  private processImage(key: string, value: any, options: Record<string, any>) {
    if (
      isEqual(key, 'icon') ||
      isEqual(key, 'image') ||
      endsWith(key, 'Icon') ||
      endsWith(key, 'Image')
    ) {
      options[key] = isString(value) ? value : this.assetService.resolveFromRequire(value);
    }
  }

  private processButtonsPassProps(key: string, value: any) {
    if (endsWith(key, 'Buttons')) {
      forEach(value, (button) => {
        if (button.passProps && button.id) {
          this.store.updateProps(button.id, button.passProps);
          button.passProps = undefined;
        }
      });
    }
  }

  private processComponent(key: string, value: any, options: Record<string, any>) {
    if (isEqual(key, 'component')) {
      value.componentId = value.id ? value.id : this.uniqueIdProvider.generate('CustomComponent');
      this.store.ensureClassForName(value.name);
      if (value.passProps) {
        this.store.updateProps(value.componentId, value.passProps);
      }
      options[key].passProps = undefined;
    }
  }

  private processSearchBar(key: string, value: OptionsSearchBar | boolean, options: OptionsTopBar) {
    if (key !== 'searchBar') {
      return;
    }

    const deprecatedSearchBarOptions: OptionsSearchBar = {
      visible: false,
      hideOnScroll: options.searchBarHiddenWhenScrolling ?? false,
      hideTopBarOnFocus: options.hideNavBarOnFocusSearchBar ?? false,
      obscuresBackgroundDuringPresentation: false,
      backgroundColor: options.searchBarBackgroundColor,
      tintColor: options.searchBarTintColor,
      placeholder: options.searchBarPlaceholder ?? '',
    };

    if (typeof value === 'boolean') {
      // Deprecated
      this.deprecations.onProcessOptions(key, options, '');

      options[key] = {
        ...deprecatedSearchBarOptions,
        visible: value,
      };
    } else {
      options[key] = {
        ...deprecatedSearchBarOptions,
        ...value,
      };
    }
  }

  private processInterpolation(key: string, value: any, options: Record<string, any>) {
    if (isEqual(key, 'interpolation')) {
      if (typeof value === 'string') {
        this.deprecations.onProcessOptions(key, options, '');
        options[key] = {
          type: options[key],
        };
      }
    }
  }

  private processAnimation(key: string, value: any, options: Record<string, any>) {
    this.processPush(key, value, options);
    this.processPop(key, value, options);
    this.processSetStackRoot(key, value, options);
  }

  private processSetStackRoot(
    key: string,
    animation: ViewAnimationOptions | StackAnimationOptions,
    parentOptions: AnimationOptions
  ) {
    if (key !== 'setStackRoot') return;
    if (!has(animation, 'content.enter') && !has(animation, 'content.exit')) {
      parentOptions[key] = {
        content: {
          enter: animation,
        },
      };
    }
  }

  private processPop(
    key: string,
    animation: StackAnimationOptions,
    parentOptions: AnimationOptions
  ) {
    if (key !== 'pop') return;
    if (!has(animation, 'content.enter') && !has(animation, 'content.exit')) {
      parentOptions.pop!!.content = {
        exit: animation.content as ViewAnimationOptions,
      };
    }
  }

  private processPush(
    key: string,
    animation: StackAnimationOptions,
    parentOptions: AnimationOptions
  ) {
    if (key !== 'push') return;
    if (!has(animation, 'content.enter') && !has(animation, 'content.exit')) {
      parentOptions.push!!.content = {
        enter: animation.content as ViewAnimationOptions,
      };
    }
  }
}
