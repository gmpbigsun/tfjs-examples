/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import {TestBed} from '@angular/core/testing';
import * as tf from '@tensorflow/tfjs';
import fetchMock from 'fetch-mock';

import {AppComponent} from './app.component';

const weightsManifest: tf.io.WeightsManifestEntry[] =
    [{name: 'Const', dtype: 'int32', shape: [1]}];

const SIMPLE_MODEL = {
  node: [
    {
      name: 'Input',
      op: 'Placeholder',
      attr: {
        dtype: {
          type: 3,
        },
        shape: {shape: {dim: [{size: -1}, {size: 1}]}}
      }
    },
    {
      name: 'Const',
      op: 'Const',
      attr: {
        dtype: {type: 3},
        value: {
          tensor: {
            dtype: 3,
            tensorShape: {dim: [{size: 1}]},
          }
        },
        index: {i: 0},
        length: {i: 4}
      }
    },
    {name: 'Add1', op: 'Add', input: ['Input', 'Const'], attr: {}},
    {name: 'Add', op: 'Add', input: ['Add1', 'Const'], attr: {}}
  ],
  versions: {producer: 1.0, minConsumer: 3}
};

describe('AppComponent', () => {
  beforeEach(async () => {
    await tf.setBackend('cpu');
    await TestBed
        .configureTestingModule({
          declarations: [AppComponent],
        })
        .compileComponents();
  });

  afterEach(() => {
    fetchMock.reset();
  });

  it('app should be successfully created', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('app should trigger an error without metadata URL query parameter', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.ngOnInit).toThrowError();
  });

  it('fetchModel should correctly parse metadata', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    // Prepare test data.
    const fakeModelMetadataUrl = 'https://modelMetadataUrl/metadata.json';
    const fakeModelUrl = 'https://modelMetadataUrl/model.json';
    const fakeTestImagesIndexPath = 'https://testImagesPath/index.json';
    const fakeModelMetadata = {
      tfjs_classifier_model_metadata: {},
      test_images_index_path: fakeTestImagesIndexPath,
    };
    const customLoader: tf.io.IOHandler = {
      load: async () => {
        return {
          modelTopology: SIMPLE_MODEL,
          weightSpecs: weightsManifest,
          weightData: new Int32Array([5]).buffer,
        };
      }
    };
    const simpleModel = await tf.loadGraphModel(customLoader);

    // Mock calls.
    fetchMock.get(fakeModelMetadataUrl, fakeModelMetadata);
    spyOn(app, 'fetchModel').and.returnValue(Promise.resolve(simpleModel));
    fetchMock.get(fakeTestImagesIndexPath, ['image1.jpg', 'image2.jpg']);

    await app.initApp(fakeModelMetadataUrl);

    expect(app.modelType).toEqual('classifier');
    expect(app.testImages).toEqual([
      {
        imageUrl: 'https://testImagesPath/image1.jpg',
        thumbnailUrl: 'https://testImagesPath/image1_thumb.jpg',
      },
      {
        imageUrl: 'https://testImagesPath/image2.jpg',
        thumbnailUrl: 'https://testImagesPath/image2_thumb.jpg',
      },
    ]);
  });

  it('fetchLabelmap should correctly parse the labelmap JSON', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    // Prepare test data.
    const fakeLabelmapUrl = 'https://labelmapUrl/labelmap.json';
    const fakeLabelmapName = 'labelmap.json';
    app.modelMetadataUrl = 'https://labelmapUrl/metadata.json';
    const fakeLabelmap = {
      item: [
        {
          id: 2,
          name: 'name2',
        },
        {
          id: 1,
          display_name: 'displayName1',
        }
      ]
    };

    // Mock calls.
    fetchMock.get(fakeLabelmapUrl, fakeLabelmap);

    await app.fetchLabelmap(fakeLabelmapName);

    expect(app.labelmap).toEqual(['unknown', 'displayName1', 'name2']);
  });

  it('runImageClassifier should correctly parse image classifier model outputs with correct labelmap',
     async () => {
       const fixture = TestBed.createComponent(AppComponent);
       const app = fixture.componentInstance;

       // Prepare test data.
       const fakeImage = new Image();
       const fakeInputTensor = tf.tensor([[1.0, 2.0], [3.0, 4.0]]);
       app.labelmap = ['someLabel', 'otherLabel', 'underThresholdLabel'];
       app.modelMetadata = {
         tfjs_classifier_model_metadata: {
           input_tensor_metadata: [1, 2, 3, 4],
           output_head_metadata: [{
             score_threshold: 0.5,
           }]
         },
       };
       const customLoader: tf.io.IOHandler = {
         load: async () => {
           return {
             modelTopology: SIMPLE_MODEL,
             weightSpecs: weightsManifest,
             weightData: new Int32Array([5]).buffer,
           };
         }
       };
       app.model = await tf.loadGraphModel(customLoader);

       // Mock calls.
       spyOn(app, 'prepareImageInput').and.returnValue(fakeInputTensor);
       spyOn(app.model, 'executeAsync')
           .and.returnValue(Promise.resolve(tf.tensor([[0.6, 0.8, 0.4]])));

       const classifierResults = await app.runImageClassifier(fakeImage);

       expect(classifierResults[0].displayName).toEqual('otherLabel');
       expect(classifierResults[0].score).toBeCloseTo(0.8);
       expect(classifierResults[1].displayName).toEqual('someLabel');
       expect(classifierResults[1].score).toBeCloseTo(0.6);
     });

  it('runImageClassifier should correctly parse image classifier model outputs with empty labelmap',
     async () => {
       const fixture = TestBed.createComponent(AppComponent);
       const app = fixture.componentInstance;

       // Prepare test data.
       const fakeImage = new Image();
       const fakeInputTensor = tf.tensor([[1.0, 2.0], [3.0, 4.0]]);
       app.labelmap = [];
       app.modelMetadata = {
         tfjs_classifier_model_metadata: {
           input_tensor_metadata: [1, 2, 3, 4],
           output_head_metadata: [{
             score_threshold: 0.5,
           }]
         },
       };
       const customLoader: tf.io.IOHandler = {
         load: async () => {
           return {
             modelTopology: SIMPLE_MODEL,
             weightSpecs: weightsManifest,
             weightData: new Int32Array([5]).buffer,
           };
         }
       };
       app.model = await tf.loadGraphModel(customLoader);

       // Mock calls.
       spyOn(app, 'prepareImageInput').and.returnValue(fakeInputTensor);
       spyOn(app.model, 'executeAsync')
           .and.returnValue(Promise.resolve(tf.tensor([[0.6, 0.8, 0.4]])));

       const classifierResults = await app.runImageClassifier(fakeImage);

       expect(classifierResults[0].displayName).toEqual('unknown');
       expect(classifierResults[0].score).toBeCloseTo(0.8);
       expect(classifierResults[1].displayName).toEqual('unknown');
       expect(classifierResults[1].score).toBeCloseTo(0.6);
     });
});
